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
assert.equal(spec.auxiliary_collaboration_required, true);
assert.equal(spec.auxiliary_collaboration_scope, "every-work-item-and-all-repository-cloudflare-use");
assert.equal(spec.auxiliary_repository_use_requires_collaboration, true);
assert.equal(spec.auxiliary_cloudflare_use_requires_collaboration, true);
assert.equal(spec.auxiliary_collaboration_default, "active");
assert.equal(spec.auxiliary_controller_may_cancel, true);
assert.equal(spec.auxiliary_cancel_authority, "web-gpt-only");
assert.equal(spec.auxiliary_cancel_requires_explicit_request, true);
assert.equal(spec.auxiliary_bypass_only_by_controller_cancel, true);
assert.equal(spec.auxiliary_work_item_handshake_required, true);
assert.equal(spec.auxiliary_normal_work_ai_required_unless_cancelled, true);
assert.deepEqual(spec.servers, [{ url: "https://governance.test", description: "Current Governance Worker origin" }]);
assert.deepEqual(spec.components?.schemas, {}, "components.schemas must be an object for GPT Actions parser compatibility");

const bearer = spec.components?.securitySchemes?.BearerAuth;
assert.equal(bearer?.type, "http");
assert.equal(bearer?.scheme, "bearer");

assert.deepEqual(Object.keys(spec.paths).sort(), [
  "/v1/assist",
  "/v1/assist/runtime",
  "/v1/assist/validate"
].sort(), "Action schema must expose only callable governance Action operations");

const assist = spec.paths?.["/v1/assist"]?.post;
assert.equal(assist?.operationId, "runGovernanceAssist");
assert.match(assist?.summary || "", /Default-on auxiliary collaboration/i);
assert.match(assist?.description || "", /every substantive work item/i);
assert.match(assist?.description || "", /governed repository/i);
assert.match(assist?.description || "", /Cloudflare-hosted capability/i);
assert.match(assist?.description || "", /Only the controlling web GPT may set auxiliary_mode=cancel/i);
assert.ok((assist?.description || "").length <= 300, "runGovernanceAssist description must stay within GPT Actions 300-character limit");
assert.deepEqual(assist?.security, [{ BearerAuth: [] }]);
const requestSchema = assist?.requestBody?.content?.["application/json"]?.schema;
assert.deepEqual(requestSchema?.required, ["prompt"]);
assert.equal(requestSchema?.properties?.max_tokens?.maximum, 16384);
assert.equal(requestSchema?.properties?.auxiliary_mode?.default, "active");
assert.deepEqual(requestSchema?.properties?.auxiliary_mode?.enum, ["active", "cancel"]);
assert.equal(requestSchema?.properties?.cancel_reason?.maxLength, 500);

const runtimeGet = spec.paths?.["/v1/assist/runtime"]?.get;
assert.equal(runtimeGet?.operationId, "getGovernanceAssistRuntime");

const validate = spec.paths?.["/v1/assist/validate"]?.post;
assert.equal(validate?.operationId, "validateGovernanceAssistFinal");
assert.deepEqual(validate?.security, [{ BearerAuth: [] }]);
assert.deepEqual(validate?.requestBody?.content?.["application/json"]?.schema?.required, ["prompt", "content"]);
assert.ok(validate?.responses?.["422"], "hard-policy rejection response must be documented");

for (const pathItem of Object.values(spec.paths)) {
  for (const operation of Object.values(pathItem)) {
    assert.equal(typeof operation.operationId, "string");
    assert.ok(operation.operationId.length > 0, "every exposed Action operation must have operationId");
    if (operation.description !== undefined) {
      assert.ok(operation.description.length <= 300, `${operation.operationId} description exceeds GPT Actions 300-character limit`);
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  suite: "governance-openapi-action-schema",
  server: spec.servers[0].url,
  operations: [
    "runGovernanceAssist",
    "getGovernanceAssistRuntime",
    "validateGovernanceAssistFinal"
  ],
  default_on_auxiliary: true,
  controller_cancel_only: true,
  work_item_handshake_required: true,
  repository_use_requires_collaboration: true,
  cloudflare_use_requires_collaboration: true,
  operation_description_max_chars: 300,
  parser_safe_components_schemas: true,
  only_callable_action_paths_exposed: true
}));
