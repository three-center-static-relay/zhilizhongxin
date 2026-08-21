import assert from "node:assert/strict";
import fs from "node:fs";

const manager=fs.readFileSync(new URL("../src/expert-route-manager.js",import.meta.url),"utf8");
const phase2=fs.readFileSync(new URL("../src/phase2-index.js",import.meta.url),"utf8");
const e2e=fs.readFileSync(new URL("../scripts/runtime-expert-route-refresh-e2e.mjs",import.meta.url),"utf8");

for(const route of [
  "expert-panel-lanes-1-2-v1",
  "expert-panel-lanes-3-4-v1",
  "expert-panel-lanes-5-6-v1",
  "expert-panel-lanes-7-8-v1"
])assert.match(manager,new RegExp(route));

assert.match(manager,/const MAX_LANES=8/);
assert.match(manager,/const MIN_LANES=2/);
assert.match(manager,/const MAX_SHARD_LANES=2/);
assert.match(manager,/const MAX_SHARD_ELEMENTS=16/);
assert.match(manager,/const GATEWAY_MODEL_RETRIES=1/);
assert.match(manager,/retries:GATEWAY_MODEL_RETRIES/);
assert.match(manager,/gateway_runtime_authority:"conditions-retries-fallbacks-model-execution"/);
assert.match(manager,/gateway_model_retries:GATEWAY_MODEL_RETRIES/);
assert.match(manager,/route_selection:"global-lane-pair"/);
assert.match(manager,/schema:"expert-route-plan-v7-executable-provider-gate"/);
assert.match(manager,/schema:"expert-route-refresh-v7-executable-provider-gate"/);
assert.match(manager,/provider_execution_policy:"native-workers-ai-plus-explicitly-verified-byok"/);
assert.match(manager,/if\(p==="workers-ai"\)return true/);
assert.match(manager,/EXPERT_ROUTE_PROVIDER_OPENROUTER_VERIFIED/);
assert.match(manager,/EXPERT_ROUTE_PROVIDER_HUGGINGFACE_VERIFIED/);
assert.match(manager,/EXPERT_ROUTE_PROVIDER_DEEPSEEK_VERIFIED/);
assert.match(manager,/universe\.candidates\.filter\(c=>routeProviderReady\(env,c\.provider\)\)/);
assert.match(manager,/discovered_candidate_count:universe\.candidate_count/);
assert.match(manager,/ROUTE_SHARDS\.map\(shard=>buildRouteShard\(shard,lanes\)\)\.filter\(Boolean\)/);
assert.match(manager,/metadata\.lane/);
assert.match(manager,/metadata\.cost_mode/);
assert.match(manager,/lanes\.length>MAX_SHARD_LANES/);
assert.match(manager,/elements\.length>MAX_SHARD_ELEMENTS/);
assert.match(manager,/created:x\.created===true/);
assert.doesNotMatch(manager,/expert-panel-(plan|general|code|regulated|research|strategy|creative)-v1/);
assert.match(phase2,/created=item\?\.created===true/);
assert.match(phase2,/else if\(created\)/);
assert.match(phase2,/NO_SAFE_ROLLBACK_TARGET/);
assert.match(e2e,/ROUTE_REFRESH_SHARD_POLICY_REQUIRED/);
assert.match(e2e,/Number\(body\?\.max_lanes_per_route\)!==2/);
assert.match(e2e,/Number\(body\?\.max_elements_per_route\)!==16/);
assert.match(e2e,/Math\.ceil\(Math\.min\(8,Number\(body\.company_count\)\)\/2\)/);
assert.match(e2e,/r\.lanes\.length>2/);
assert.match(e2e,/Number\(r\?\.element_count\)>16/);

console.log(JSON.stringify({ok:true,suite:"expert-route-lane-pair-shard-contract",max_global_lanes:8,max_lanes_per_route:2,max_elements_per_route:16,route_shards:4,semantic_graph_duplication_removed:true,rollback_delete_requires_created:true,provider_execution_gate:true,workers_ai_native:true,third_party_requires_verified_byok:true,gateway_model_retries:1,gateway_runtime_authority:"conditions-retries-fallbacks-model-execution"}));
