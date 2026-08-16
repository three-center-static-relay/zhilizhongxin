import assert from "node:assert/strict";
import worker from "../src/production-entry.js";

const openapi=await worker.fetch(new Request("https://governance.test/openapi.json"),{},{}),spec=await openapi.json();
assert.equal(openapi.status,200);
const op=spec.paths?.["/v1/intelligence/literature-selftest"]?.post;
assert.equal(op?.operationId,"runLiteratureProductionSelftest");
assert.deepEqual(op?.security,[{BearerAuth:[]}]);
assert.ok((op?.description||"").length<=300);

const unauth=await worker.fetch(new Request("https://governance.test/v1/intelligence/literature-selftest",{method:"POST"}),{ADMIN_GPT_TOKEN:"secret"},{}),ub=await unauth.json();
assert.equal(unauth.status,401);assert.equal(ub.error,"UNAUTHORIZED");

let seen=null;
const env={ADMIN_GPT_TOKEN:"secret",INTELLIGENCE_CENTER:{async fetch(req){seen={url:req.url,method:req.method};return Response.json({ok:true,business_e2e:true,selftest:"literature-production-keys",checks:[{provider:"openalex",ok:true},{provider:"semantic_scholar",ok:true},{provider:"base",ok:true}]})}}};
const ok=await worker.fetch(new Request("https://governance.test/v1/intelligence/literature-selftest",{method:"POST",headers:{authorization:"Bearer secret","content-type":"application/json"},body:"{}"}),env,{}),body=await ok.json();
assert.equal(ok.status,200);assert.equal(body.ok,true);assert.equal(body.business_e2e,true);assert.equal(body.selftest?.checks?.length,3);assert.equal(seen.url,"https://intelligence.internal/v1/selftest/literature");assert.equal(seen.method,"POST");

const missing=await worker.fetch(new Request("https://governance.test/v1/intelligence/literature-selftest",{method:"POST",headers:{authorization:"Bearer secret"}}),{ADMIN_GPT_TOKEN:"secret"},{}),mb=await missing.json();
assert.equal(missing.status,503);assert.equal(mb.error,"CENTER_UNCONFIGURED");

console.log(JSON.stringify({ok:true,suite:"literature-action-route",operationId:"runLiteratureProductionSelftest",service_binding:"INTELLIGENCE_CENTER",auth:"ADMIN_GPT_TOKEN"}));
