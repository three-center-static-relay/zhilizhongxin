import assert from "node:assert/strict";
import worker from "../src/entry.js";
import { assistRuntimeIdentity } from "../src/assist-runtime.js";

const response = await worker.fetch(new Request("https://governance.test/openapi.json", { method: "GET" }), {}, {});
assert.equal(response.status, 200);
const spec = await response.json();
const runtime = assistRuntimeIdentity();

assert.equal(spec.openapi, "3.1.0");
assert.equal(spec.info.version, runtime.policy_version);
assert.equal(spec.policy_version, runtime.policy_version);
assert.equal(spec.validator_version, runtime.validator_version);

const bearer = spec.components?.securitySchemes?.BearerAuth;
assert.equal(bearer?.type, "http");
assert.equal(bearer?.scheme, "bearer");

const assist = spec.paths?.["/v1/assist"]?.post;
assert.equal(assist?.operationId, "runGovernanceAssist");
assert.deepEqual(assist?.security, [{ BearerAuth: [] }]);
assert.deepEqual(assist?.requestBody?.content?.["application/json"]?.schema?.required, ["prompt"]);
assert.equal(assist?.requestBody?.content?.["application/json"]?.schema?.properties?.max_tokens?.maximum, 16384);

const runtimeGet = spec.paths?.["/v1/assist/runtime"]?.get;
assert.equal(runtimeGet?.operationId, "getGovernanceAssistRuntime");

const validate = spec.paths?.["/v1/assist/validate"]?.post;
assert.equal(validate?.operationId, "validateGovernanceAssistFinal");
assert.deepEqual(validate?.security, [{ BearerAuth: [] }]);
assert.deepEqual(validate?.requestBody?.content?.["application/json"]?.schema?.required, ["prompt", "content"]);
assert.ok(validate?.responses?.["422"], "hard-policy rejection response must be documented");

console.log(JSON.stringify({
  ok: true,
  suite: "governance-openapi-action-schema",
  operations: [
    "runGovernanceAssist",
    "getGovernanceAssistRuntime",
    "validateGovernanceAssistFinal"
  ]
}));
