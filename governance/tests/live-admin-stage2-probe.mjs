import assert from "node:assert/strict";

const target="https://admin-worker.a15280020511.workers.dev/_internal/ai-gateway-credential-read-probe";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),10000);
try{
  const response=await fetch(target,{method:"GET",headers:{accept:"application/json","x-three-center-selftest":"1"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,`LIVE_ADMIN_STAGE2_READ_HTTP:${response.status}`);
  assert.equal(body?.ok,true);
  assert.equal(body?.selftest,"admin-maintenance-ai-gateway-credential-read-v1");
  assert.equal(body?.credential_broker_bound,true);
  assert.equal(body?.credential_source,"maintenance-worker");
  assert.equal(body?.routes_readable,true);
  assert.equal(body?.error_code,null);
  assert.equal(body?.dynamic_route_mutation,false);
  assert.equal(body?.expert_called,false);
  assert.equal(body?.secrets_redacted,true);
  console.log(JSON.stringify({ok:true,suite:"live-admin-stage2-read",http_status:response.status,credential_broker_bound:true,credential_source:"maintenance-worker",routes_readable:true,dynamic_route_mutation:false,expert_called:false,secrets_redacted:true}));
} finally {
  clearTimeout(timer);
}
