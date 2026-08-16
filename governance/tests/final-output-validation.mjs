import assert from "node:assert/strict";
import { runFinalAssistValidation } from "../src/assist-final-validator.js";
import { assistRuntimeIdentity } from "../src/assist-runtime.js";

const TOKEN = "test-admin-token";
const env = { ADMIN_GPT_TOKEN: TOKEN };

function request(body, token = TOKEN) {
  return new Request("https://governance.test/v1/assist/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

async function validate(body, token = TOKEN) {
  const response = await runFinalAssistValidation(request(body, token), env);
  return { status: response.status, body: await response.json() };
}

const runtime = assistRuntimeIdentity();
assert.equal(runtime.policy_version, "governance-assist-policy-v3-20260816");
assert.equal(runtime.validator_version, "governance-assist-validator-v3-20260816");
assert.equal(runtime.runtime_attested, true);

// Active production E2E failure cannot be softened to DEGRADED.
{
  const result = await validate({
    prompt: "新版本已经部署生产，真实业务 E2E 失败。请给出总体状态。",
    content: "整体系统状态：DEGRADED。失败版本必须立即回滚。"
  });
  assert.equal(result.status, 422);
  assert.equal(result.body.http_status, 422);
  assert.equal(result.body.error, "FINAL_OUTPUT_POLICY_REJECTED");
  assert.equal(result.body.validation_error, "NONCOMPLIANT_E2E_STATE_OUTPUT");
}

// HTTP 503 with content is still a failed attempt, not something to rescue with output-contract review.
{
  const result = await validate({
    prompt: "HTTP 503 但响应体里有完整正文，如何判断？",
    content: "需看输出契约，不直接成功。"
  });
  assert.equal(result.status, 422);
  assert.equal(result.body.http_status, 422);
  assert.equal(result.body.validation_error, "NONCOMPLIANT_NON2XX_OUTPUT");
}

// Runtime profile cannot be self-graded PASS without runtime evidence.
{
  const result = await validate({
    prompt: "代码声明 high-reasoning Profile，但没有生产运行时回执或 metadata。请自评。",
    content: "高推理 Profile：PASS"
  });
  assert.equal(result.status, 422);
  assert.equal(result.body.http_status, 422);
  assert.equal(result.body.validation_error, "UNVERIFIED_RUNTIME_PROFILE_PASS");
}

// Red-team/tool/test claims require a verifiable receipt in the governing input.
{
  const result = await validate({
    prompt: "请审查答卷；当前没有红队工具回执或调用记录。",
    content: "红队审查支持该判断：失败版本必须回滚。"
  });
  assert.equal(result.status, 422);
  assert.equal(result.body.http_status, 422);
  assert.equal(result.body.validation_error, "UNVERIFIED_EXECUTION_CLAIM");
}

// A compliant final answer returns only validation metadata/digests, not the answer body.
{
  const result = await validate({
    prompt: "新版本已经部署生产，真实业务 E2E 失败。请给出总体状态。",
    content: "整体系统状态：FAIL-CLOSED。失败版本必须立即回滚到最近一个已验证稳定版本。"
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.http_status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.validation, "PASS");
  assert.equal(result.body.final_output_validated, true);
  assert.equal(result.body.policy_version, runtime.policy_version);
  assert.equal(result.body.validator_version, runtime.validator_version);
  assert.match(result.body.content_sha256, /^[a-f0-9]{64}$/);
  assert.match(result.body.prompt_sha256, /^[a-f0-9]{64}$/);
  assert.equal("content" in result.body, false, "validator receipt must not echo the task answer");
}

// Authentication remains before validation.
{
  const result = await validate({ prompt: "x", content: "y" }, "wrong-token");
  assert.equal(result.status, 401);
  assert.equal(result.body.http_status, 401);
  assert.equal(result.body.error, "UNAUTHORIZED");
}

console.log(JSON.stringify({
  ok: true,
  suite: "governance-final-output-validation",
  tests: [
    "runtime-policy-attestation",
    "reject-degraded-on-active-e2e-failure",
    "reject-non2xx-rescue",
    "reject-unverified-profile-pass",
    "reject-unverified-redteam-claim",
    "validated-output-receipt",
    "auth-before-validation",
    "http-status-mirrored-in-body"
  ]
}));
