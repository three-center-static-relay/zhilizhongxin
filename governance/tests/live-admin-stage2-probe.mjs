import assert from "node:assert/strict";

const target="https://admin-worker.a15280020511.workers.dev/_internal/ai-gateway-credential-read-probe";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),10000);
try{
  const response=await fetch(target,{method:"GET",headers:{accept:"application/json","x-three-center-selftest":"1"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.ok([200,502,503].includes(response.status),`LIVE_ADMIN_STAGE2_PROBE_UNEXPECTED_HTTP:${response.status}`);
  assert.equal(body?.selftest,"admin-maintenance-ai-gateway-credential-read-v1");
  assert.equal(body?.dynamic_route_mutation,false);
  assert.equal(body?.expert_called,false);
  assert.equal(body?.secrets_redacted,true);
  console.log(JSON.stringify({ok:true,suite:"live-admin-stage2-endpoint-presence",http_status:response.status,credential_broker_bound:body?.credential_broker_bound===true,routes_readable:body?.routes_readable===true,error_code:String(body?.error_code||"").slice(0,120),secrets_redacted:true}));
} finally {
  clearTimeout(timer);
}
