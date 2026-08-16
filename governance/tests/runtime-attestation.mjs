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
  assert.equal(response.headers.get("x-governance-policy-version"), runtime.policy_version);
}

// Deterministic hard-rule path must also be attested and must not require an AI binding.
{
  const request = new Request("https://governance.test/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify({ prompt: "HTTP 200 但 content 为空，算成功吗？" })
  });
  const response = await runAttestedAssist(request, { ADMIN_GPT_TOKEN: "test-token" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.http_status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider, "governance-policy-kernel");
  assert.equal(body.policy_version, runtime.policy_version);
  assert.equal(body.validator_version, runtime.validator_version);
  assert.equal(body.runtime_attested, true);
  assert.match(body.content, /不算成功|失败/);
}

console.log(JSON.stringify({
  ok: true,
  suite: "governance-runtime-attestation",
  tests: [
    "zero-cost-runtime-selftest",
    "attestation-on-auth-failure",
    "attestation-on-deterministic-policy-path",
    "http-status-mirrored-in-body"
  ]
}));
