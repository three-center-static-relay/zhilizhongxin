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
assert.equal(p.ok,true);assert.equal(p.provider,"tencent");assert.equal(p.automatic_selection,true);assert.equal(p.acknowledgement_required,null);assert.equal(p.execution_allowed,true);

p=planChinaFabric({capability:"browser",message:"open example.com"},status);
assert.equal(p.provider,"tencent");assert.equal(p.execution_allowed,true);

p=planChinaFabric({capability:"free-cpu"},status);
assert.equal(p.provider,"modelscope");assert.equal(p.execution_allowed,true);assert.equal(p.cost_class,"free-only");

p=planChinaFabric({capability:"llm",prompt:"42"},status);
assert.equal(p.provider,"baidu");assert.equal(p.acknowledgement_required,"allow_metered");assert.equal(p.execution_allowed,false);
p=planChinaFabric({capability:"llm",prompt:"42",allow_metered:true},status);
assert.equal(p.provider,"baidu");assert.equal(p.execution_allowed,true);

p=planChinaFabric({capability:"functiongraph",payload:{x:1}},status);
assert.equal(p.provider,"huawei");assert.equal(p.acknowledgement_required,"allow_metered");
p=planChinaFabric({capability:"functiongraph",payload:{x:1},allow_metered:true},status);
assert.equal(p.execution_allowed,true);

p=planChinaFabric({capability:"paid-sandbox",code:"print(42)"},status);
assert.equal(p.provider,"aliyun");assert.equal(p.acknowledgement_required,"allow_paid");assert.equal(p.execution_allowed,false);
p=planChinaFabric({capability:"paid-sandbox",code:"print(42)",allow_paid:true},status);
assert.equal(p.execution_allowed,true);

p=planChinaFabric({capability:"llm",provider:"tencent",prompt:"x"},status);
assert.equal(p.ok,false);assert.equal(p.error,"PROVIDER_CAPABILITY_MISMATCH");

const down=structuredClone(status);down.providers.modelscope.route_eligible=false;
p=planChinaFabric({capability:"free-cpu"},down);
assert.equal(p.ok,false);assert.equal(p.error,"PROVIDER_NOT_READY");assert.equal(p.provider,"modelscope");

const source=fs.readFileSync(new URL("../src/production-superguard.js",import.meta.url),"utf8");
for(const route of [
  "/v1/admin/compute/fabric/status",
  "/v1/admin/compute/fabric/plan",
  "/v1/admin/compute/fabric/run",
  "/v1/admin/compute/fabric/task"
])assert.ok(source.includes(route),`Missing fabric route: ${route}`);
for(const required of ["await auth(req,env)","productionTencentFailed", "chinaFabricStatus", "runChinaFabric"])
  assert.ok(source.includes(required),`Missing fabric guard: ${required}`);

const fabric=fs.readFileSync(new URL("../src/china-compute-fabric.js",import.meta.url),"utf8");
for(const literal of [
  'automatic_provider_set:["tencent","modelscope"]',
  'explicit_metered_provider_set:["baidu","huawei"]',
  'explicit_paid_provider_set:["aliyun"]',
  'paid_fallback:false',
  'COMPUTE_ORIGIN="https://compute.internal"',
  '/v1/providers/baidu-llm/inference',
  '/v1/providers/huawei-functiongraph/compute',
  '/v1/providers/aliyun-fc-sandbox/run',
  '/v1/admin/modelscope/studio-lite/run'
])assert.ok(fabric.includes(literal),`Missing fabric safety contract: ${literal}`);

console.log(JSON.stringify({ok:true,suite:"china-compute-fabric-contract",providers:["tencent","modelscope","baidu","huawei","aliyun"],automatic:["tencent","modelscope"],metered_ack:["baidu","huawei"],paid_ack:["aliyun"],paid_fallback:false,fail_closed:true}));
