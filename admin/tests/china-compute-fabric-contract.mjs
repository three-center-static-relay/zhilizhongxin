import assert from "node:assert/strict";
import fs from "node:fs";
import {planChinaFabric} from "../src/china-compute-fabric.js";

const ready=(cost_class)=>({ok:true,route_eligible:true,cost_class,paid_fallback:false});
const status={providers:{
  tencent:ready("platform-contained"),
  modelscope:ready("free-only"),
  baidu:ready("free-quota-then-metered-unknown"),
  huawei:ready("free-tier-then-metered"),
  aliyun:ready("paid")
}};

let p=planChinaFabric({capability:"agent",message:"hello"},status);
assert.equal(p.ok,true);assert.equal(p.provider,"tencent");assert.equal(p.automatic_selection,true);assert.equal(p.acknowledgement_required,null);assert.equal(p.execution_allowed,true);assert.equal(p.validation_only,false);
p=planChinaFabric({capability:"browser",message:"open example.com"},status);assert.equal(p.provider,"tencent");assert.equal(p.execution_allowed,true);
p=planChinaFabric({capability:"free-cpu-validation"},status);assert.equal(p.provider,"modelscope");assert.equal(p.execution_allowed,true);assert.equal(p.cost_class,"free-only");assert.equal(p.validation_only,true);
p=planChinaFabric({capability:"free-cpu"},status);assert.equal(p.ok,false);assert.equal(p.error,"UNSUPPORTED_CAPABILITY");
p=planChinaFabric({capability:"llm",prompt:"42"},status);assert.equal(p.provider,"baidu");assert.equal(p.acknowledgement_required,"allow_metered");assert.equal(p.execution_allowed,false);
p=planChinaFabric({capability:"llm",prompt:"42",allow_metered:true},status);assert.equal(p.provider,"baidu");assert.equal(p.execution_allowed,true);
p=planChinaFabric({capability:"functiongraph",payload:{x:1}},status);assert.equal(p.provider,"huawei");assert.equal(p.acknowledgement_required,"allow_metered");
p=planChinaFabric({capability:"functiongraph",payload:{x:1},allow_metered:true},status);assert.equal(p.execution_allowed,true);
p=planChinaFabric({capability:"paid-sandbox",code:"print(42)"},status);assert.equal(p.provider,"aliyun");assert.equal(p.acknowledgement_required,"allow_paid");assert.equal(p.execution_allowed,false);
p=planChinaFabric({capability:"paid-sandbox",code:"print(42)",allow_paid:true},status);assert.equal(p.execution_allowed,true);
p=planChinaFabric({capability:"llm",provider:"tencent",prompt:"x"},status);assert.equal(p.ok,false);assert.equal(p.error,"PROVIDER_CAPABILITY_MISMATCH");

const down=structuredClone(status);down.providers.modelscope.route_eligible=false;
p=planChinaFabric({capability:"free-cpu-validation"},down);assert.equal(p.ok,false);assert.equal(p.error,"PROVIDER_NOT_READY");assert.equal(p.provider,"modelscope");

const source=fs.readFileSync(new URL("../src/production-superguard.js",import.meta.url),"utf8");
for(const route of ["/v1/admin/compute/fabric/status","/v1/admin/compute/fabric/plan","/v1/admin/compute/fabric/run","/v1/admin/compute/fabric/task"])
  assert.ok(source.includes(route),`Missing fabric route: ${route}`);
for(const required of ["await auth(req,env)","productionTencentAttested","chinaFabricStatus","runChinaFabric"])
  assert.ok(source.includes(required),`Missing fabric guard: ${required}`);
assert.ok(source.includes('if(!productionTencentAttested(env))return fail("TENCENT_PRODUCTION_E2E_NOT_PASSED"'),"Direct Tencent agent must require a positive production attestation");
assert.ok(!source.includes('if(productionTencentFailed(env))'),"Direct Tencent agent must not treat absence of a failure marker as sufficient production authorization");
for(const awaited of ['return await fabricStatus(req,env,u)','return await fabricPlan(req,env)','return await fabricRun(req,env)','return await fabricTask(req,env,u)'])
  assert.ok(source.includes(awaited),`Fabric async route must stay inside fetch error boundary: ${awaited}`);
for(const unsafe of ['return fabricStatus(req,env,u)','return fabricPlan(req,env)','return fabricRun(req,env)','return fabricTask(req,env,u)'])
  assert.ok(!source.includes(unsafe),`Unawaited fabric route may escape fetch error boundary: ${unsafe}`);

const fabric=fs.readFileSync(new URL("../src/china-compute-fabric.js",import.meta.url),"utf8");
for(const literal of [
  'automatic_business_provider_set:["tencent"]','validation_only_provider_set:["modelscope"]',
  'explicit_metered_provider_set:["baidu","huawei"]','explicit_paid_provider_set:["aliyun"]',
  'generic_business_task_adapter:false','paid_fallback:false','COMPUTE_ORIGIN="https://compute.internal"',
  '/v1/providers/baidu-llm/inference','/v1/providers/huawei-functiongraph/compute',
  '/v1/providers/aliyun-fc-sandbox/run','/v1/admin/modelscope/studio-lite/run'
])assert.ok(fabric.includes(literal),`Missing fabric safety contract: ${literal}`);

console.log(JSON.stringify({ok:true,suite:"china-compute-fabric-contract",providers:["tencent","modelscope","baidu","huawei","aliyun"],automatic_business:["tencent"],validation_only:["modelscope"],metered_ack:["baidu","huawei"],paid_ack:["aliyun"],paid_fallback:false,fail_closed:true,awaited_route_error_boundary:true,direct_tencent_requires_positive_attestation:true}));
