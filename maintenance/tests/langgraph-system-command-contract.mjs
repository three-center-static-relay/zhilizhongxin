import assert from "node:assert/strict";
import fs from "node:fs";

const wrapper=fs.readFileSync(new URL("../src/system-phase2-index.js",import.meta.url),"utf8");
const config=fs.readFileSync(new URL("../wrangler.phase2.jsonc",import.meta.url),"utf8");
const e2e=fs.readFileSync(new URL("../scripts/runtime-expert-phase2-e2e.mjs",import.meta.url),"utf8");

assert.match(wrapper,/https:\/\/admin\.internal\/v1\/admin\/langgraph\/run/);
assert.match(wrapper,/governance\.task-planner/);
assert.match(wrapper,/intelligence\.provider-query/);
assert.match(wrapper,/compute\.cpu/);
assert.match(wrapper,/expert\.deliberation/);
assert.match(wrapper,/all_centers_connected_to_langgraph/);
assert.match(wrapper,/brain_can_command/);
assert.match(wrapper,/langgraph_validated/);
assert.match(wrapper,/production_mutation:brain\?\.production_mutation===true/);
assert.match(config,/"main": "src\/system-phase2-index\.js"/);
assert.match(config,/"ADMIN_CENTER"/);
assert.match(e2e,/EXPERT_V4_2_AND_LANGGRAPH_SYSTEM_RUNTIME_PASS/);
assert.match(e2e,/LANGGRAPH_SYSTEM_COMMAND_REQUIRED/);
assert.match(e2e,/LANGGRAPH_RUNTIME_TOPOLOGY_REQUIRED/);
assert.match(e2e,/LANGGRAPH_COMMAND_POLICY_REQUIRED/);
for(const center of ["governance","intelligence","compute","expert"])assert.match(e2e,new RegExp(center));

console.log(JSON.stringify({ok:true,suite:"langgraph-full-system-command-contract",expert_route_real_e2e_required:true,all_four_centers_required:true,production_mutation:false}));
