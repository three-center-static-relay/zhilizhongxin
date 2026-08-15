import assert from "node:assert/strict";
import { runAttestedAssist } from "../src/assist-attested.js";

function req(prompt) {
  return new Request("https://governance.test/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, max_tokens: 256 })
  });
}

const hostileEnv = {
  AI: {
    run() {
      throw new Error("AI_MUST_NOT_BE_CALLED_BY_COMPAT_SELFTEST");
    }
  },
  OPENROUTER_RELAY: {
    fetch() {
      throw new Error("OPENROUTER_MUST_NOT_BE_CALLED_BY_COMPAT_SELFTEST");
    }
  }
};

{
  const response = await runAttestedAssist(req("__SELFTEST_RUNTIME_ATTESTATION__"), hostileEnv);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.selftest, "runtime-attestation");
  assert.equal(body.ai_called, false);
  assert.equal(body.cost_incurred, false);
  assert.equal(body.policy_version, "governance-assist-policy-v3-20260816");
  assert.equal(body.validator_version, "governance-assist-validator-v3-20260816");
  assert.equal(body.runtime_schema, "assist-runtime-attestation-v1");
  assert.equal(body.runtime_attested, true);
  assert.equal(response.headers.get("x-governance-policy-version"), body.policy_version);
  assert.equal(response.headers.get("x-governance-validator-version"), body.validator_version);
}

{
  const response = await runAttestedAssist(req("__SELFTEST_FINAL_VALIDATOR__"), hostileEnv);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.selftest, "final-validator");
  assert.equal(body.ai_called, false);
  assert.equal(body.cost_incurred, false);
  assert.equal(body.validation, "PASS");
  assert.equal(body.runtime_attested, true);
  assert.equal(body.checks.length, 5);
  assert.ok(body.checks.every(item => item.ok), "all final-validator compatibility checks must pass");
  assert.deepEqual(body.checks.map(item => item.observed), [
    "NONCOMPLIANT_E2E_STATE_OUTPUT",
    "NONCOMPLIANT_NON2XX_OUTPUT",
    "UNVERIFIED_RUNTIME_PROFILE_PASS",
    "UNVERIFIED_EXECUTION_CLAIM",
    "ACCEPTED"
  ]);
}

console.log(JSON.stringify({
  ok: true,
  suite: "governance-legacy-action-compat-selftests",
  tests: [
    "runtime-attestation-through-runGovernanceAssist",
    "final-validator-through-runGovernanceAssist",
    "zero-ai-zero-cost-compat-selftests"
  ]
}));
