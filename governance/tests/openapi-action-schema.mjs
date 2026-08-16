import assert from "node:assert/strict";
import worker from "../src/admin-entry.js";
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
assert.equal(bearer?.type, "http");assert.equal(bearer?.scheme, "bearer");

const approvedPaths=[
  "/v1/assist","/v1/assist/runtime","/v1/assist/validate",
  "/v1/intelligence/literature-selftest","/v1/intelligence/provider-selftest",
  "/v1/compute/commercial-spatial","/v1/compute/commercial-spatial/status",
  "/v1/admin/context","/v1/admin/health","/v1/admin/versions",
  "/v1/admin/candidates","/v1/admin/candidates/validate","/v1/admin/acceptance"
];
assert.deepEqual(Object.keys(spec.paths).sort(),approvedPaths.sort(),"Deployed Action schema must expose exactly the approved governance operations");

const assist=spec.paths?.["/v1/assist"]?.post;
assert.equal(assist?.operationId,"runGovernanceAssist");assert.match(assist?.summary||"",/Default-on auxiliary collaboration/i);assert.match(assist?.description||"",/every substantive work item/i);assert.match(assist?.description||"",/governed repository/i);assert.match(assist?.description||"",/Cloudflare-hosted capability/i);assert.match(assist?.description||"",/Only the controlling web GPT may set auxiliary_mode=cancel/i);assert.deepEqual(assist?.security,[{BearerAuth:[]}]);
const requestSchema=assist?.requestBody?.content?.["application/json"]?.schema;assert.deepEqual(requestSchema?.required,["prompt"]);assert.equal(requestSchema?.properties?.max_tokens?.maximum,16384);assert.equal(requestSchema?.properties?.auxiliary_mode?.default,"active");assert.deepEqual(requestSchema?.properties?.auxiliary_mode?.enum,["active","cancel"]);assert.equal(requestSchema?.properties?.cancel_reason?.maxLength,500);
assert.equal(spec.paths?.["/v1/assist/runtime"]?.get?.operationId,"getGovernanceAssistRuntime");
const validate=spec.paths?.["/v1/assist/validate"]?.post;assert.equal(validate?.operationId,"validateGovernanceAssistFinal");assert.deepEqual(validate?.security,[{BearerAuth:[]}]);assert.deepEqual(validate?.requestBody?.content?.["application/json"]?.schema?.required,["prompt","content"]);assert.ok(validate?.responses?.["422"]);

const literature=spec.paths?.["/v1/intelligence/literature-selftest"]?.post;assert.equal(literature?.operationId,"runLiteratureProductionSelftest");assert.deepEqual(literature?.security,[{BearerAuth:[]}]);assert.equal(literature?.requestBody?.required,false);assert.match(literature?.description||"",/OpenAlex/i);assert.match(literature?.description||"",/Semantic Scholar/i);assert.match(literature?.description||"",/BASE/i);
const providerE2E=spec.paths?.["/v1/intelligence/provider-selftest"]?.post;assert.equal(providerE2E?.operationId,"runProviderFreshE2E");assert.deepEqual(providerE2E?.security,[{BearerAuth:[]}]);assert.equal(providerE2E?.requestBody?.required,false);assert.match(providerE2E?.description||"",/zero-AI/i);assert.match(providerE2E?.description||"",/approved provider set/i);assert.ok(providerE2E?.responses?.["200"]);assert.ok(providerE2E?.responses?.["503"]);

const commercial=spec.paths?.["/v1/compute/commercial-spatial"]?.post;assert.equal(commercial?.operationId,"runCommercialSpatialFusion");assert.deepEqual(commercial?.security,[{BearerAuth:[]}]);const cs=commercial?.requestBody?.content?.["application/json"]?.schema;assert.equal(cs?.additionalProperties,false);assert.deepEqual(cs?.required,["rings","source_receipts"]);assert.equal(cs?.properties?.rings?.minItems,1);assert.equal(cs?.properties?.rings?.maxItems,5);assert.equal(cs?.properties?.source_receipts?.minItems,2);assert.equal(cs?.properties?.source_receipts?.maxItems,12);for(const forbidden of ["provider","profile","gpu","model_id","url","code","network"])assert.equal(cs?.properties?.[forbidden],undefined,`${forbidden} must not be exposed`);assert.ok(commercial?.responses?.["202"]);assert.ok(commercial?.responses?.["409"]);
const commercialStatus=spec.paths?.["/v1/compute/commercial-spatial/status"]?.post;assert.equal(commercialStatus?.operationId,"getCommercialSpatialFusionStatus");const statusSchema=commercialStatus?.requestBody?.content?.["application/json"]?.schema;assert.equal(statusSchema?.additionalProperties,false);assert.deepEqual(statusSchema?.required,["task_id"]);assert.deepEqual(Object.keys(statusSchema?.properties||{}),["task_id"]);

for(const [path,operationId] of Object.entries({"/v1/admin/context":"getAdminContext","/v1/admin/health":"getSystemHealth","/v1/admin/versions":"getProductionVersions"})){const operation=spec.paths?.[path]?.get;assert.equal(operation?.operationId,operationId);assert.deepEqual(operation?.security,[{BearerAuth:[]}]);assert.equal(spec.paths?.[path]?.post,undefined)}
const createCandidate=spec.paths?.["/v1/admin/candidates"]?.post;assert.equal(createCandidate?.operationId,"createCandidateVersion");assert.deepEqual(createCandidate?.security,[{BearerAuth:[]}]);assert.equal(createCandidate?.requestBody?.required,true);const candidateSchema=createCandidate?.requestBody?.content?.["application/json"]?.schema;assert.equal(candidateSchema?.additionalProperties,false);assert.deepEqual(candidateSchema?.required,["branch","commits"]);assert.deepEqual(candidateSchema?.properties?.commits?.required,["governance","intelligence","compute","expert"]);for(const center of ["governance","intelligence","compute","expert"])assert.equal(candidateSchema?.properties?.commits?.properties?.[center]?.pattern,"^[A-Fa-f0-9]{40}$");assert.ok(createCandidate?.responses?.["202"]);assert.ok(createCandidate?.responses?.["409"]);assert.ok(createCandidate?.responses?.["503"]);assert.match(createCandidate?.description||"",/versions upload/i);assert.match(createCandidate?.description||"",/production traffic is never changed/i);
const validateCandidate=spec.paths?.["/v1/admin/candidates/validate"]?.post;assert.equal(validateCandidate?.operationId,"validateCandidate");assert.deepEqual(validateCandidate?.requestBody?.content?.["application/json"]?.schema?.required,["candidate_id"]);assert.ok(validateCandidate?.responses?.["200"]);assert.ok(validateCandidate?.responses?.["202"]);assert.ok(validateCandidate?.responses?.["422"]);assert.match(validateCandidate?.description||"",/No runtime E2E is claimed/i);
const acceptance=spec.paths?.["/v1/admin/acceptance"]?.get;assert.equal(acceptance?.operationId,"getAcceptanceResult");assert.equal(acceptance?.parameters?.[0]?.name,"run_id");assert.equal(acceptance?.parameters?.[0]?.in,"query");assert.equal(acceptance?.parameters?.[0]?.required,true);

const operationIds=[];for(const pathItem of Object.values(spec.paths))for(const operation of Object.values(pathItem)){assert.equal(typeof operation.operationId,"string");assert.ok(operation.operationId.length>0);if(operation.description!==undefined)assert.ok(operation.description.length<=300,`${operation.operationId} description exceeds GPT Actions 300-character limit`);operationIds.push(operation.operationId)}
assert.equal(operationIds.length,13);assert.equal(new Set(operationIds).size,operationIds.length,"operationId values must remain unique");assert.equal(operationIds.includes("runProviderFreshE2E"),true);assert.equal(operationIds.includes("runCommercialSpatialFusion"),true);assert.equal(operationIds.includes("getCommercialSpatialFusionStatus"),true);assert.equal(operationIds.includes("promoteCandidate"),false);assert.equal(operationIds.includes("rollbackProduction"),false);

console.log(JSON.stringify({ok:true,suite:"governance-openapi-action-schema",server:spec.servers[0].url,operations:operationIds,operation_count:operationIds.length,phase_2_candidate_acceptance:true,commercial_spatial_action:true,fixed_commercial_model:true,production_mutation_actions:0,operation_description_max_chars:300,parser_safe_components_schemas:true,deployed_entry_schema_verified:true}));
