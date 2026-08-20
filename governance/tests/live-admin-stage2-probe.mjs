import assert from "node:assert/strict";

const target="https://governance-worker.a15280020511.workers.dev/_internal/ai-gateway-control-readonly-probe";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),12000);
try{
  const response=await fetch(target,{method:"GET",headers:{accept:"application/json","x-three-center-selftest":"1"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.ok([200,502,503].includes(response.status),`LIVE_GOVERNANCE_PROBE_UNEXPECTED_HTTP:${response.status}`);
  assert.equal(body?.selftest,"governance-ai-gateway-control-readonly-v1");
  assert.equal(body?.dynamic_route_mutation,false);
  assert.equal(body?.expert_called,false);
  assert.equal(body?.secrets_redacted,true);
  console.log(JSON.stringify({ok:true,suite:"live-governance-probe-presence",http_status:response.status,binding:body?.binding===true,broker_rpc:body?.broker_rpc===true,routes_readable:body?.routes_readable===true,error_code:String(body?.error_code||"").slice(0,120),secrets_redacted:true}));
} finally {
  clearTimeout(timer);
}
