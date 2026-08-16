import assert from "node:assert/strict";
import { runAttestedAssist, runtimeSelftestResponse } from "../src/assist-attested.js";
import { assistRuntimeIdentity } from "../src/assist-runtime.js";

const runtime = assistRuntimeIdentity();

// Zero-cost runtime selftest must identify the exact policy/validator build without invoking AI.
{
  const response = runtimeSelftestResponse();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.http_status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.selftest, "runtime-attestation");
  assert.equal(body.ai_called, false);
  assert.equal(body.cost_incurred, false);
  assert.equal(body.policy_version, "governance-assist-policy-v3-20260816");
  assert.equal(body.validator_version, "governance-assist-validator-v3-20260816");
  assert.equal(body.runtime_attested, true);
  assert.equal(body.auxiliary_tool_access, "none");
  assert.equal(body.auxiliary_tools_allowed, false);
  assert.equal(body.auxiliary_collaboration_required, true);
  assert.equal(body.auxiliary_collaboration_scope, "every-work-item");
  assert.equal(body.auxiliary_collaboration_default, "active");
  assert.equal(body.auxiliary_controller_may_cancel, true);
  assert.equal(body.auxiliary_cancel_authority, "web-gpt-only");
  assert.equal(body.auxiliary_cancel_requires_explicit_request, true);
  assert.equal(body.auxiliary_work_item_handshake_required, true);
  assert.equal(body.auxiliary_normal_work_ai_required_unless_cancelled, true);
  assert.equal(body.auxiliary_outage_behavior, "web-gpt-degraded-fallback");
  assert.equal(response.headers.get("x-governance-policy-version"), runtime.policy_version);
  assert.equal(response.headers.get("x-governance-validator-version"), runtime.validator_version);
  assert.equal(response.headers.get("x-governance-runtime-attested"), "true");
}

// Even authentication failures must carry runtime identity so an old/side-path Worker is detectable.
{
  const request = new Request("https://governance.test/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
    body: JSON.stringify({ prompt: "test" })
  });
  const response = await runAttestedAssist(request, { ADMIN_GPT_TOKEN: "correct-token" });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.http_status, 401);
  assert.equal(body.error, "UNAUTHORIZED");
  assert.equal(body.policy_version, runtime.policy_version);
  assert.equal(body.validator_version, runtime.validator_version);
  assert.equal(body.auxiliary_tool_access, "none");
  assert.equal(body.auxiliary_tools_allowed, false);
  assert.equal(body.auxiliary_collaboration_required, true);
  assert.equal(response.headers.get("x-governance-policy-version"), runtime.policy_version);
}

// Normal work defaults to active and must reach an auxiliary model even when deterministic guidance already exists.
{
  let aiCalls = 0;
  let observedSystem = "";
  const request = new Request("https://governance.test/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify({ prompt: "HTTP 200 但 content 为空，算成功吗？" })
  });
  const response = await runAttestedAssist(request, {
    ADMIN_GPT_TOKEN: "test-token",
    AI: {
      async run(_model, params) {
        aiCalls += 1;
        observedSystem = params?.messages?.[0]?.content || "";
        return { response: "不算成功。HTTP 200 只代表传输成功；content 为空仍必须按失败处理。", usage: { input_tokens: 1, output_tokens: 1 } };
      }
    }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.http_status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider, "cloudflare-workers-ai");
  assert.equal(aiCalls, 1, "default active work must invoke an auxiliary model");
  assert.equal(body.collaboration_required, true);
  assert.equal(body.collaboration_status, "participated");
  assert.equal(body.policy_kernel_guidance_applied, true);
  assert.match(observedSystem, /AUTHORITATIVE DETERMINISTIC POLICY GUIDANCE/);
  assert.equal(body.policy_version, runtime.policy_version);
  assert.equal(body.validator_version, runtime.validator_version);
  assert.equal(body.runtime_attested, true);
  assert.equal(body.auxiliary_tool_access, "none");
  assert.equal(body.auxiliary_tools_allowed, false);
}

// Only an authenticated controlling web GPT may explicitly cancel auxiliary participation for one work item.
{
  let aiCalls = 0;
  const request = new Request("https://governance.test/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify({
      prompt: "本次工作由总控直接处理。",
      auxiliary_mode: "cancel",
      cancel_reason: "controller override test"
    })
  });
  const response = await runAttestedAssist(request, {
    ADMIN_GPT_TOKEN: "test-token",
    AI: { async run() { aiCalls += 1; return { response: "should not run" }; } }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.http_status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider, "governance-collaboration-control");
  assert.equal(body.collaboration_status, "cancelled-by-controller");
  assert.equal(body.collaboration_cancel_authority, "web-gpt-only");
  assert.equal(body.collaboration_cancel_explicit, true);
  assert.equal(body.auxiliary_called, false);
  assert.equal(body.ai_called, false);
  assert.equal(body.cost_incurred, false);
  assert.equal(body.cancel_reason, "controller override test");
  assert.equal(aiCalls, 0, "controller cancellation must stop auxiliary model invocation");
}

// Cancellation cannot bypass authentication.
{
  const request = new Request("https://governance.test/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
    body: JSON.stringify({ prompt: "x", auxiliary_mode: "cancel" })
  });
  const response = await runAttestedAssist(request, { ADMIN_GPT_TOKEN: "correct-token" });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error, "UNAUTHORIZED");
}

console.log(JSON.stringify({
  ok: true,
  suite: "governance-runtime-attestation",
  tests: [
    "zero-cost-runtime-selftest",
    "attestation-on-auth-failure",
    "default-active-ai-on-normal-work",
    "explicit-controller-cancel-without-ai",
    "cancel-cannot-bypass-auth",
    "zero-tool-and-collaboration-runtime-attestation",
    "http-status-mirrored-in-body"
  ]
}));
