import assert from "node:assert/strict";
import fs from "node:fs";

const wrapper=fs.readFileSync(new URL("../src/system-phase2-index.js",import.meta.url),"utf8");
const config=fs.readFileSync(new URL("../wrangler.phase2.jsonc",import.meta.url),"utf8");
const e2e=fs.readFileSync(new URL("../scripts/runtime-expert-phase2-e2e.mjs",import.meta.url),"utf8");

assert.match(wrapper,/https:\/\/admin\.internal\/v1\/admin\/langgraph\/run/);
for(const capability of ["governance.task-planner","intelligence.provider-query","intelligence.dataset-radar","compute.cpu","compute.simulation","expert.deliberation","expert.judgment"])assert.match(wrapper,new RegExp(capability.replaceAll(".","\\.")));
assert.match(wrapper,/all_centers_connected_to_langgraph/);
assert.match(wrapper,/brain_can_command/);
assert.match(wrapper,/langgraph_validated/);
assert.match(wrapper,/production_mutation:brain\?\.production_mutation===true/);
assert.match(wrapper,/failClosedBrain/);
assert.match(wrapper,/intelligenceBusiness/);
assert.match(wrapper,/computeBusiness|computeFinish/);
assert.match(wrapper,/expertBusiness/);
assert.match(wrapper,/route_ai/);
assert.match(config,/"main": "src\/system-phase2-index\.js"/);
assert.match(config,/"ADMIN_CENTER"/);
assert.match(e2e,/EXPERT_V4_2_AND_LANGGRAPH_COMPLEX_RUNTIME_PASS/);
assert.match(e2e,/LANGGRAPH_SYSTEM_COMMAND_REQUIRED/);
assert.match(e2e,/LANGGRAPH_RUNTIME_TOPOLOGY_REQUIRED/);
assert.match(e2e,/LANGGRAPH_COMMAND_POLICY_REQUIRED/);
assert.match(e2e,/COMPLEX_RUNTIME_SUITE_REQUIRED/);
assert.match(e2e,/FAIL_CLOSED_NEGATIVE_REQUIRED/);
assert.match(e2e,/INTELLIGENCE_BUSINESS_E2E_REQUIRED/);
assert.match(e2e,/COMPUTE_BUSINESS_E2E_REQUIRED/);
assert.match(e2e,/EXPERT_COMPLEX_E2E_REQUIRED/);
assert.match(e2e,/ROUTE_AI_COMPLEX_E2E_REQUIRED/);
for(const center of ["governance","intelligence","compute","expert"])assert.match(e2e,new RegExp(center));

console.log(JSON.stringify({ok:true,suite:"langgraph-complex-system-command-contract",expert_route_real_e2e_required:true,all_four_centers_required:true,complex_business_suite_required:true,fail_closed_negative_required:true,production_mutation:false}));
