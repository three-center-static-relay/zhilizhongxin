import assert from "node:assert/strict";

const target="https://governance-worker.a15280020511.workers.dev/_internal/ai-gateway-control-readonly-probe";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),12000);
try{
  const response=await fetch(target,{method:"GET",headers:{accept:"application/json","x-three-center-selftest":"1"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,`LIVE_GOVERNANCE_ADMIN_RPC_HTTP:${response.status}`);
  assert.equal(body?.ok,true);
  assert.equal(body?.selftest,"governance-ai-gateway-control-readonly-v1");
  assert.equal(body?.binding,true);
  assert.equal(body?.broker_rpc,true);
  assert.equal(body?.routes_readable,true);
  assert.equal(body?.error_code,null);
  assert.equal(body?.dynamic_route_mutation,false);
  assert.equal(body?.expert_called,false);
  assert.equal(body?.secrets_redacted,true);
  console.log(JSON.stringify({ok:true,suite:"live-governance-admin-ai-gateway-read",http_status:response.status,binding:true,broker_rpc:true,routes_readable:true,dynamic_route_mutation:false,expert_called:false,secrets_redacted:true}));
} finally {
  clearTimeout(timer);
}
