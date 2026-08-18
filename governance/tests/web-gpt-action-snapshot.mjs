import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/admin-entry.js";

const snapshot = JSON.parse(readFileSync(new URL("../web-gpt-action/LATEST.openapi.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../web-gpt-action/manifest.json", import.meta.url), "utf8"));
const server = manifest.production_server;

const response = await worker.fetch(new Request(`${server}/openapi.json`, { method: "GET" }), {}, {});
assert.equal(response.status, 200, "deployed entrypoint must generate OpenAPI successfully");
const runtime = await response.json();

function actionProjection(spec) {
  return {openapi:spec.openapi,info:{title:spec.info?.title,version:spec.info?.version},servers:spec.servers,paths:spec.paths,components:spec.components};
}

assert.deepEqual(actionProjection(snapshot),actionProjection(runtime),"LATEST.openapi.json drifted from src/admin-entry.js; update the canonical Web GPT Action snapshot in the same change");
assert.equal(manifest.status,"LATEST");
assert.equal(manifest.canonical_file,"governance/web-gpt-action/LATEST.openapi.json");
assert.equal(manifest.source_entry,"governance/src/admin-entry.js");
assert.equal(manifest.copy_paste_ready,true);
assert.equal(manifest.secret_free,true);
assert.equal(manifest.phase,"phase-2-cloudflare-dry-run-build-acceptance");
assert.equal(manifest.candidate_kind,"cloudflare-dry-run-build-set");
assert.equal(manifest.candidate_deploy_command_required,"npm run cf:build && npx wrangler deploy --dry-run");
assert.equal(manifest.candidate_branch_main_allowed,false);
assert.equal(manifest.fresh_business_e2e,false);
assert.equal(manifest.provider_fresh_e2e_action,true);
assert.equal(manifest.commercial_spatial_action,true);
assert.equal(manifest.commercial_spatial_model_fixed,"location_intelligence.commercial_spatial_fusion");
assert.equal(manifest.commercial_spatial_provider_fixed,"kaggle");
assert.equal(manifest.commercial_spatial_profile_fixed,"gis");
assert.equal(manifest.commercial_spatial_gpu,false);
assert.equal(manifest.commercial_spatial_arbitrary_code,false);
assert.equal(manifest.production_mutation_actions,0);
assert.equal(manifest.promote_enabled,false);
assert.equal(manifest.rollback_enabled,false);
assert.equal(manifest.cloudflare_builds_runtime_requirements.account_id_var,"CLOUDFLARE_ACCOUNT_ID");
assert.equal(manifest.cloudflare_builds_runtime_requirements.api_token_secret,"CLOUDFLARE_BUILDS_API_TOKEN");
assert.equal(manifest.cloudflare_builds_runtime_requirements.api_token_user_scoped,true);
assert.equal(manifest.cloudflare_builds_runtime_requirements.production_secret_value_stored_in_repository,false);
assert.equal(snapshot.servers?.length,1);
assert.equal(snapshot.servers?.[0]?.url,server);
assert.deepEqual(snapshot.components?.schemas,{});
assert.equal(snapshot.components?.securitySchemes?.BearerAuth?.type,"http");
assert.equal(snapshot.components?.securitySchemes?.BearerAuth?.scheme,"bearer");

const operations=[];
for(const [path,pathItem] of Object.entries(snapshot.paths||{}))for(const [method,operation] of Object.entries(pathItem||{})){
  assert.equal(typeof operation.operationId,"string",`${method.toUpperCase()} ${path} must have operationId`);
  assert.ok(operation.operationId.length>0,`${method.toUpperCase()} ${path} operationId must not be empty`);
  if(operation.description!==undefined)assert.ok(operation.description.length<=300,`${operation.operationId} description exceeds 300 characters`);
  operations.push(operation.operationId);
}
assert.equal(new Set(operations).size,operations.length,"operationId values must be unique");
assert.deepEqual([...operations].sort(),[...manifest.required_operation_ids].sort(),"manifest operation list must exactly match the canonical Action schema");
assert.equal(operations.length,13);
for(const required of ["runProviderFreshE2E","runCommercialSpatialFusion","getCommercialSpatialFusionStatus","createCandidateVersion","validateCandidate","getAcceptanceResult"])assert.ok(operations.includes(required));
for(const forbidden of ["promoteCandidate","rollbackProduction"])assert.equal(operations.includes(forbidden),false);

const providerE2E=snapshot.paths?.["/v1/intelligence/provider-selftest"]?.post;
assert.equal(providerE2E?.operationId,"runProviderFreshE2E");
assert.equal(providerE2E?.requestBody?.required,false);
assert.ok(providerE2E?.responses?.["200"]);
assert.ok(providerE2E?.responses?.["503"]);
const commercial=snapshot.paths?.["/v1/compute/commercial-spatial"]?.post;
assert.equal(commercial?.operationId,"runCommercialSpatialFusion");
assert.deepEqual(commercial?.requestBody?.content?.["application/json"]?.schema?.required,["rings","source_receipts"]);
assert.equal(commercial?.requestBody?.content?.["application/json"]?.schema?.additionalProperties,false);
assert.equal(commercial?.requestBody?.content?.["application/json"]?.schema?.properties?.source_receipts?.minItems,2);
assert.equal(commercial?.requestBody?.content?.["application/json"]?.schema?.properties?.rings?.maxItems,5);
assert.equal(commercial?.requestBody?.content?.["application/json"]?.schema?.properties?.provider,undefined);
assert.equal(commercial?.requestBody?.content?.["application/json"]?.schema?.properties?.model_id,undefined);
assert.equal(commercial?.requestBody?.content?.["application/json"]?.schema?.properties?.url,undefined);
assert.equal(commercial?.requestBody?.content?.["application/json"]?.schema?.properties?.code,undefined);
const commercialStatus=snapshot.paths?.["/v1/compute/commercial-spatial/status"]?.post;
assert.equal(commercialStatus?.operationId,"getCommercialSpatialFusionStatus");
assert.deepEqual(commercialStatus?.requestBody?.content?.["application/json"]?.schema?.required,["task_id"]);
const candidate=snapshot.paths?.["/v1/admin/candidates"]?.post;
assert.equal(candidate?.requestBody?.required,true);
const candidateSchema=candidate?.requestBody?.content?.["application/json"]?.schema;
assert.deepEqual(candidateSchema?.required,["branch","commits"]);
assert.deepEqual(candidateSchema?.properties?.commits?.required,["governance","intelligence","compute","expert"]);
assert.ok(candidate?.responses?.["202"]);
assert.equal(candidate?.responses?.["201"],undefined);
const candidateValidate=snapshot.paths?.["/v1/admin/candidates/validate"]?.post;
assert.ok(candidateValidate?.responses?.["202"]);
assert.match(candidateValidate?.description||"",/No runtime E2E is claimed/i);

const raw=JSON.stringify(snapshot);
assert.equal(raw.includes("ADMIN_GPT_TOKEN"),false,"Action snapshot must never contain the controller secret name/value");
assert.equal(raw.includes("CLOUDFLARE_BUILDS_API_TOKEN"),false,"Action schema must not expose the Cloudflare Builds secret name/value");
assert.equal(/Bearer\s+[A-Za-z0-9._~-]{16,}/.test(raw),false,"Action snapshot appears to contain a bearer credential");
assert.equal(/sk-[A-Za-z0-9_-]{12,}/.test(raw),false,"Action snapshot appears to contain an API credential");

console.log(JSON.stringify({ok:true,suite:"web-gpt-action-canonical-latest",snapshot_version:manifest.snapshot_version,server,operations,operation_count:operations.length,phase:manifest.phase,candidate_kind:manifest.candidate_kind,fresh_business_e2e:false,provider_fresh_e2e_action:true,commercial_spatial_action:true,production_mutation_actions:0,promote_enabled:false,rollback_enabled:false,drift_guard:true,secret_free:true,copy_paste_ready:true}));
