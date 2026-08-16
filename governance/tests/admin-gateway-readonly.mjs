import assert from "node:assert/strict";
import worker from "../src/admin-entry.js";

const TOKEN="admin-test-token";
let downstreamCalls=0;
function center(service,versionId,digest){return{fetch:async request=>{downstreamCalls+=1;assert.equal(new URL(request.url).pathname,"/v1/admin/context");return Response.json({ok:true,service,admin_read_only:true,observed_at:"2026-08-16T00:00:00.000Z",runtime_version:{id:versionId,tag:null,timestamp:"2026-08-16T00:00:00.000Z"},health:{ok:true,status:"ready",service,api_version:"test"},source:{ok:true,service,api_version:"test",source_digest:digest,secrets_redacted:true},acceptance:{ok:true,status:"not_verified"},active_task:null,active_state_verified:true,secrets_redacted:true});}}}
const env={ADMIN_GPT_TOKEN:TOKEN,CF_VERSION_METADATA:{id:"gov-version",tag:null,timestamp:"2026-08-16T00:00:00.000Z"},INTELLIGENCE_CENTER:center("intelligence-worker","intel-version","a".repeat(64)),COMPUTE_CENTER:center("compute-worker","compute-version","b".repeat(64)),EXPERT_CENTER:center("expert-worker","expert-version","c".repeat(64))};
const auth={authorization:`Bearer ${TOKEN}`};

{
  downstreamCalls=0;
  const response=await worker.fetch(new Request("https://governance.test/v1/admin/context",{headers:{authorization:"Bearer wrong"}}),env,{}),body=await response.json();
  assert.equal(response.status,401);assert.equal(body.ok,false);assert.equal(body.http_status,401);assert.equal(downstreamCalls,0);
}
{
  downstreamCalls=0;
  const response=await worker.fetch(new Request("https://governance.test/v1/admin/context",{headers:auth}),env,{}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.http_status,200);assert.equal(body.receipt_schema,"three-center-admin-read-receipt-v1");assert.equal(body.operation,"getAdminContext");assert.equal(body.read_only,true);assert.equal(body.tested_candidate,null);assert.equal(body.rollback_target,null);assert.match(body.run_id,/^admin-getAdminContext-/);assert.match(body.receipt_digest,/^[a-f0-9]{64}$/);assert.equal(body.data.status,"COMPLETE");assert.equal(body.data.context_is_not_acceptance,true);assert.deepEqual(Object.keys(body.data.centers).sort(),["compute","expert","governance","intelligence"]);assert.equal(downstreamCalls,3);
}
{
  const response=await worker.fetch(new Request("https://governance.test/v1/admin/health",{headers:auth}),env,{}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.operation,"getSystemHealth");assert.equal(body.data.overall_status,"HEALTHY");assert.equal(body.data.health_is_not_acceptance,true);assert.match(body.receipt_digest,/^[a-f0-9]{64}$/);
}
{
  const response=await worker.fetch(new Request("https://governance.test/v1/admin/versions",{headers:auth}),env,{}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.operation,"getProductionVersions");assert.equal(body.data.status,"VERIFIED");for(const center of Object.values(body.data.current_production)){assert.equal(center.verified,true);assert.ok(center.runtime_version_id);assert.match(center.source_digest,/^[a-f0-9]{64}$/);}
}
{
  const response=await worker.fetch(new Request("https://governance.test/openapi.json"),env,{}),spec=await response.json(),operations=[];
  for(const [path,item] of Object.entries(spec.paths))for(const [method,op] of Object.entries(item)){operations.push(op.operationId);assert.ok(["get","post"].includes(method));if(op.description!==undefined)assert.ok(op.description.length<=300,`${op.operationId} description exceeds 300 characters`);}
  assert.deepEqual(operations.sort(),["getAdminContext","getGovernanceAssistRuntime","getProductionVersions","getSystemHealth","runGovernanceAssist","runLiteratureProductionSelftest","runProviderFreshE2E","validateGovernanceAssistFinal","createCandidateVersion","validateCandidate","getAcceptanceResult"].sort());
  for(const path of ["/v1/admin/context","/v1/admin/health","/v1/admin/versions"]){assert.deepEqual(spec.paths[path].get.security,[{BearerAuth:[]}]);assert.equal(spec.paths[path].post,undefined,"phase-1 read routes remain read-only");}
  assert.equal(operations.includes("runProviderFreshE2E"),true);
  assert.equal(operations.includes("promoteCandidate"),false);assert.equal(operations.includes("rollbackProduction"),false);
}

console.log(JSON.stringify({ok:true,suite:"governance-admin-gateway-readonly",admin_read_operations:3,total_production_operations:11,receipt_schema:"three-center-admin-read-receipt-v1",production_mutation_actions:0,literature_action_preserved:true,provider_fresh_e2e_action_preserved:true}));
