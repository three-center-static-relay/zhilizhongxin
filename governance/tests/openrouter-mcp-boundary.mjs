import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const policy=JSON.parse(fs.readFileSync(path.join(root,"config/openrouter-mcp-policy.json"),"utf8"));

assert.equal(policy.version,"openrouter-mcp-governance-layer-v1-20260817");
assert.equal(policy.endpoint,"https://mcp.openrouter.ai/mcp");
assert.equal(policy.role,"governance-maintenance-assistant");
assert.equal(policy.production_inference_path,false);
assert.equal(policy.expert_center_runtime_dependency,false);
assert.equal(policy.authentication.unattended_production_allowed,false);
assert.equal(policy.hard_boundaries.may_select_or_recommend_models,true);
assert.equal(policy.hard_boundaries.may_execute_expert_business_tasks,false);
assert.equal(policy.hard_boundaries.may_enable_expert_tools_or_web,false);
assert.equal(policy.hard_boundaries.fail_closed_on_auth_or_session_failure,true);
assert.equal(policy.hard_boundaries.fallback,"continue-production-on-openrouter-rest-without-mcp");
assert.equal(policy.restricted_capabilities["send-message"].default,"deny");
assert.equal(policy.restricted_capabilities["send-message"].production_routing,false);
assert.equal(policy.production_contract.expert_transport,"openrouter-rest");
assert.equal(policy.production_contract.catalog_endpoint,"https://openrouter.ai/api/v1/models");
assert.equal(policy.production_contract.chat_endpoint,"https://openrouter.ai/api/v1/chat/completions");
assert.equal(policy.production_contract.mcp_endpoint_forbidden_in_expert_runtime,true);

for(const tool of ["list-models","get-model","list-model-endpoints","list-benchmarks","list-daily-model-rankings","search-docs","get-credits","list-providers"]){
  assert.ok(policy.allowed_capabilities.includes(tool),`missing governance MCP capability: ${tool}`);
}

console.log(JSON.stringify({ok:true,suite:"openrouter-mcp-boundary",version:policy.version,production_transport:policy.production_contract.expert_transport,mcp_role:policy.role}));
