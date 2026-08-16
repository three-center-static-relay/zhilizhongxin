import assert from "node:assert/strict";
import app from "../src/production-entry.js";

const payload={ok:true,selftest:"provider-fresh-e2e",runtime:true,ai_called:false,providers_checked:4,bigquery_query_scan:false,bigquery_bytes_billed:0,receipt_digest:"a".repeat(64),observed_at:"2026-08-16T00:00:00.000Z",checks:[
  {id:"bigquery-metadata",ok:true,terminal_status:"pass",lock_released:true,bigquery_bytes_billed:0},
  {id:"earthengine-public-asset",ok:true,terminal_status:"pass",lock_released:true},
  {id:"google-patents-public",ok:true,terminal_status:"pass",lock_released:true,bigquery_bytes_billed:0},
  {id:"pkulaw-health",ok:true,terminal_status:"pass",lock_released:true,status:"healthy",auth_ok:true,transport_ok:true,law_data_ok:true,case_data_ok:true}
]};
let calls=0;
const env={ADMIN_GPT_TOKEN:"unit-admin-token",INTELLIGENCE_CENTER:{fetch:async req=>{calls++;assert.equal(new URL(req.url).pathname,"/v1/selftest/providers");assert.equal(new URL(req.url).hostname,"intelligence.internal");return Response.json(payload)}}};
const unauthorized=await app.fetch(new Request("https://governance.example/v1/intelligence/provider-selftest",{method:"POST"}),env,{});assert.equal(unauthorized.status,401);assert.equal(calls,0);
const ok=await app.fetch(new Request("https://governance.example/v1/intelligence/provider-selftest",{method:"POST",headers:{authorization:"Bearer unit-admin-token"}}),env,{}),body=await ok.json();
assert.equal(ok.status,200);assert.equal(body.ok,true);assert.equal(body.suite,"provider-fresh-e2e");assert.equal(body.business_e2e,true);assert.equal(body.ai_called,false);assert.equal(body.bigquery_query_scan,false);assert.equal(body.bigquery_bytes_billed,0);assert.equal(body.receipt_digest,"a".repeat(64));assert.equal(body.checks.length,4);assert.equal(body.secrets_redacted,true);assert.equal(calls,1);
const spec=await app.fetch(new Request("https://governance.example/openapi.json"),env,{}),openapi=await spec.json();assert.ok(openapi.paths?.["/v1/intelligence/provider-selftest"]?.post);assert.equal(openapi.paths["/v1/intelligence/provider-selftest"].post.operationId,"runProviderFreshE2E");
console.log(JSON.stringify({ok:true,suite:"provider-fresh-e2e-route",authenticated:true,service_binding:true,ai_called:false}));
