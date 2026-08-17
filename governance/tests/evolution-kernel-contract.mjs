import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildManifest,makeCapability,validateManifest} from "../src/capability-abi.js";
import {governanceCapabilityManifest} from "../src/governance-capability-manifest.js";
import {buildSelfModel,compileTaskPlan,entropyReport,kernelSnapshot,validateEvolutionContract,validateTaskEnvelope} from "../src/evolution-kernel.js";
import {evolutionOpenApiPaths,handleEvolutionRoute} from "../src/evolution-router.js";

const observed="2026-08-18T00:00:00.000Z";
const capability=(id,center,operations,trust="T0")=>makeCapability({id,type:"atomic",domain:center,operations,provider:`${center}-worker`,protocol:"service-binding",auth_scope:"service-binding",permission_scope:"read",network_scope:center==="compute"?"allowlisted-compute":"none",write_scope:"none",health:{status:"ready",checked_at:observed},trust:{level:trust,status:"verified"},reliability:{score:0.9,basis:"test"},accuracy:{score:0.8,basis:"test"},first_seen:observed,last_verified:observed});
const manifests=[
  governanceCapabilityManifest(),
  buildManifest("intelligence",[capability("intelligence.literature-search","intelligence",["literature.search","evidence.retrieve"],"T1")]),
  buildManifest("compute",[capability("compute.simulation","compute",["simulation.run","statistics.compute"],"T2")]),
  buildManifest("expert",[capability("expert.deliberation","expert",["expert.assess","judgment.synthesize"],"T2")])
];

for(const manifest of manifests)assert.deepEqual(validateManifest(manifest),{ok:true,errors:[]});
const self=buildSelfModel(manifests);
assert.equal(self.center_count,4);
assert.ok(self.capability_count>=9);
const task={task_id:"adaptive-contract-1",goal:"Retrieve literature and run a bounded simulation",constraints:{allowed_centers:["intelligence","compute"],write_scope:"none"},risk:{max_trust_level:"T2",uncertainty:"high"},budget:{currency:"USD",max_cost:0},required_capabilities:["literature.search","simulation.run"],deadline:"2026-08-19T00:00:00.000Z",success_criteria:["evidence returned","simulation receipt returned","no production write"]};
assert.deepEqual(validateTaskEnvelope(task),{ok:true,errors:[]});
assert.equal(validateTaskEnvelope({...task,unexpected:true}).ok,false);
const plan=await compileTaskPlan(task,manifests);
assert.equal(plan.ok,true);
assert.equal(plan.path,"deep");
assert.equal(plan.graph.nodes.length,2);
assert.equal(plan.execution_started,false);
assert.equal(plan.langgraph_execution_enabled,false);
assert.match(plan.plan_digest,/^[a-f0-9]{64}$/);
const blocked=await compileTaskPlan({...task,task_id:"adaptive-contract-2",required_capabilities:["unknown.future-capability"]},manifests);
assert.equal(blocked.status,"BLOCKED");
assert.deepEqual(blocked.unresolved,["unknown.future-capability"]);
const candidate={candidate_id:"candidate-1",parent_id:"main",reason:"close capability gap",hypothesis:"adds verified capability",affected_components:["governance"],expected_gain:{quality:0.1},complexity_delta:1,risk_delta:0,benchmark:{static_check:{required:true},simulation:{required:true},shadow:{required:true},canary:{required:true}},rollback_target:"main",production_mutation:false};
assert.equal(validateEvolutionContract(candidate).ok,true);
assert.equal(validateEvolutionContract({...candidate,production_mutation:true}).ok,false);
assert.equal(entropyReport(manifests,Date.parse("2026-08-18T01:00:00.000Z")).automatic_delete,false);
assert.equal(kernelSnapshot().autonomous_production_mutation,false);
assert.ok(evolutionOpenApiPaths()["/v1/evolution/plan"]);
const centerBinding=manifest=>({fetch:async()=>Response.json({ok:true,capability_manifest:manifest})});
const routeEnv={
  ADMIN_GPT_TOKEN:"route-test-token",
  INTELLIGENCE_CENTER:centerBinding(manifests[1]),
  COMPUTE_CENTER:centerBinding(manifests[2]),
  EXPERT_CENTER:centerBinding(manifests[3])
};
const publicKernel=await handleEvolutionRoute(new Request("https://governance.test/v1/evolution/kernel"),routeEnv);
assert.equal(publicKernel.status,200);
assert.equal((await publicKernel.json()).production_write,false);
const unauthorized=await handleEvolutionRoute(new Request("https://governance.test/v1/evolution/self-model"),routeEnv);
assert.equal(unauthorized.status,401);
const authorizedSelfModel=await handleEvolutionRoute(new Request("https://governance.test/v1/evolution/self-model",{headers:{authorization:"Bearer route-test-token"}}),routeEnv);
assert.equal(authorizedSelfModel.status,200);
assert.equal((await authorizedSelfModel.json()).self_model.center_count,4);
const routePlan=await handleEvolutionRoute(new Request("https://governance.test/v1/evolution/plan",{method:"POST",headers:{authorization:"Bearer route-test-token","content-type":"application/json"},body:JSON.stringify(task)}),routeEnv);
assert.equal(routePlan.status,200);
const routePlanBody=await routePlan.json();
assert.equal(routePlanBody.status,"PLANNED");
assert.equal(routePlanBody.execution_started,false);
for(const path of ["config/l0-constitution.json","config/evolution-policy.json","schemas/capability-abi-v1.schema.json","schemas/task-envelope-v1.schema.json","schemas/evidence-envelope-v1.schema.json","schemas/receipt-envelope-v1.schema.json","schemas/evolution-contract-v1.schema.json"])JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),"utf8"));
console.log(JSON.stringify({ok:true,suite:"evolution-kernel-contract",phase_0:true,phase_1_foundation:true,phase_2_deterministic_graph:true,production_mutation:false}));
