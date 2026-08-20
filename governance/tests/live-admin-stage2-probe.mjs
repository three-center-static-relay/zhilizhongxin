import assert from "node:assert/strict";

const target="https://governance-worker.a15280020511.workers.dev/openapi.json";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),10000);
try{
  const response=await fetch(target,{method:"GET",headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,`LIVE_GOVERNANCE_OPENAPI_HTTP:${response.status}`);
  assert.equal(body?.openapi,"3.1.0");
  assert.ok(body?.info&&typeof body.info==="object");
  console.log(JSON.stringify({ok:true,suite:"live-governance-origin-reachable",http_status:response.status,openapi:body.openapi,secrets_redacted:true}));
} finally {
  clearTimeout(timer);
}
