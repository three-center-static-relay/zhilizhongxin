import assert from "node:assert/strict";
import worker,{AdminState} from "../src/admin-entry.js";

const TOKEN="phase2-admin-token";
const COMMITS={
  governance:"1".repeat(40),
  intelligence:"2".repeat(40),
  compute:"3".repeat(40),
  expert:"4".repeat(40)
};
const SCRIPT_BY_TAG={
  "tag-governance":"governance-worker",
  "tag-intelligence":"intelligence-worker",
  "tag-compute":"compute-worker",
  "tag-expert":"expert-worker"
};
let downstreamCalls=0;
const versions={intelligence:"intel-v1",compute:"compute-v1",expert:"expert-v1"};
const active={intelligence:null,compute:null,expert:null};
function center(name,service,digest){return{fetch:async request=>{downstreamCalls+=1;assert.equal(new URL(request.url).pathname,"/v1/admin/context");return Response.json({ok:true,service,admin_read_only:true,observed_at:"2026-08-16T00:00:00.000Z",runtime_version:{id:versions[name],tag:null,timestamp:"2026-08-16T00:00:00.000Z"},health:{ok:true,status:"ready",service,api_version:"test"},source:{ok:true,service,api_version:"test",source_digest:digest,secrets_redacted:true},acceptance:{ok:true,status:"not_verified"},active_task:active[name],active_state_verified:true,secrets_redacted:true});}}}
class MemoryStorage{constructor(){this.map=new Map()}async get(key){return this.map.get(key)}async put(key,value){this.map.set(key,structuredClone(value))}async delete(key){this.map.delete(key)}}
const storage=new MemoryStorage(),stateObject=new AdminState({storage},{});
let stateCalls=0;
const stateBinding={idFromName:name=>name,get:()=>({fetch:async request=>{stateCalls+=1;return stateObject.fetch(request)}})};
const env={
  ADMIN_GPT_TOKEN:TOKEN,
  CLOUDFLARE_ACCOUNT_ID:"account-test",
  CLOUDFLARE_BUILDS_API_TOKEN:"cf-builds-test-token",
  CF_VERSION_METADATA:{id:"gov-v1",tag:null,timestamp:"2026-08-16T00:00:00.000Z"},
  INTELLIGENCE_CENTER:center("intelligence","intelligence-worker","a".repeat(64)),
  COMPUTE_CENTER:center("compute","compute-worker","b".repeat(64)),
  EXPERT_CENTER:center("expert","expert-worker","c".repeat(64)),
  ADMIN_STATE:stateBinding
};
const auth={authorization:`Bearer ${TOKEN}`,"content-type":"application/json"};

let buildPosts=0,cancelPuts=0,pendingCenter=null,failedCenter=null,unsafePreview=false,failTriggerCenter=null;
const builds=new Map();
const originalFetch=globalThis.fetch;
globalThis.fetch=async (input,init={})=>{
  const url=new URL(String(input));
  const method=String(init.method||"GET").toUpperCase();
  const prefix="/client/v4/accounts/account-test";
  assert.ok(url.pathname.startsWith(prefix));
  const path=url.pathname.slice(prefix.length);

  if(method==="GET"&&path==="/workers/scripts"){
    return Response.json({success:true,result:[
      {id:"governance-worker",tag:"tag-governance"},
      {id:"intelligence-worker",tag:"tag-intelligence"},
      {id:"compute-worker",tag:"tag-compute"},
      {id:"expert-worker",tag:"tag-expert"}
    ]});
  }

  let m=path.match(/^\/builds\/workers\/([^/]+)\/triggers$/);
  if(method==="GET"&&m){
    const tag=decodeURIComponent(m[1]),script=SCRIPT_BY_TAG[tag];
    return Response.json({success:true,result:[
      {trigger_uuid:`prod-${tag}`,deploy_command:"npx wrangler deploy",branch_includes:["main"],branch_excludes:[]},
      {trigger_uuid:`preview-${tag}`,deploy_command:unsafePreview&&script==="governance-worker"?"npm run cf:build && npx wrangler deploy":"npm run cf:build && npx wrangler versions upload",branch_includes:["*"],branch_excludes:["main"]}
    ]});
  }

  m=path.match(/^\/builds\/triggers\/preview-(tag-[^/]+)\/builds$/);
  if(method==="POST"&&m){
    const tag=decodeURIComponent(m[1]),script=SCRIPT_BY_TAG[tag],center=Object.keys(COMMITS).find(x=>`${x==="governance"?"governance":x}-worker`===script)||script.replace("-worker","");
    if(failTriggerCenter===center)return Response.json({success:false,errors:[{code:12000,message:"forced trigger failure"}]},{status:503});
    buildPosts+=1;
    const body=JSON.parse(init.body);
    const uuid=`build-${center}-${buildPosts}`;
    builds.set(uuid,{center,branch:body.branch,commit_hash:body.commit_hash});
    return Response.json({success:true,result:{build_uuid:uuid,created_on:"2026-08-16T00:00:00.000Z"}});
  }

  m=path.match(/^\/builds\/builds\/([^/]+)$/);
  if(method==="GET"&&m){
    const uuid=decodeURIComponent(m[1]),record=builds.get(uuid);
    if(!record)return Response.json({success:false,errors:[{code:12000,message:"not found"}]},{status:404});
    const running=record.center===pendingCenter;
    const failed=record.center===failedCenter;
    return Response.json({success:true,result:{
      build_uuid:uuid,
      status:running?"running":"stopped",
      build_outcome:running?null:(failed?"fail":"success"),
      created_on:"2026-08-16T00:00:00.000Z",
      stopped_on:running?null:"2026-08-16T00:01:00.000Z",
      build_trigger_metadata:{branch:record.branch,commit_hash:record.commit_hash,deploy_command:"npm run cf:build && npx wrangler versions upload"},
      trigger:{deploy_command:"npm run cf:build && npx wrangler versions upload",branch_excludes:["main"]}
    }});
  }

  m=path.match(/^\/builds\/builds\/([^/]+)\/cancel$/);
  if(method==="PUT"&&m){cancelPuts+=1;return Response.json({success:true,result:{build_uuid:decodeURIComponent(m[1]),build_outcome:"cancelled"}});}

  throw new Error(`Unexpected Cloudflare API request: ${method} ${path}`);
};

try {
  // Authentication is evaluated before downstream state or Cloudflare API use.
  {
    downstreamCalls=0;stateCalls=0;buildPosts=0;
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:{authorization:"Bearer wrong","content-type":"application/json"},body:"{}"}),env,{});
    assert.equal(response.status,401);assert.equal(downstreamCalls,0);assert.equal(stateCalls,0);assert.equal(buildPosts,0);
  }

  // Runtime request contract requires a non-main branch and four exact 40-hex commit SHAs.
  for(const invalidBody of [
    {},
    {branch:"main",commits:COMMITS},
    {branch:"candidate/test",commits:{...COMMITS,compute:"bad"}},
    {branch:"candidate/test",commits:{...COMMITS,extra:"5".repeat(40)}},
    {branch:"candidate/test",commits:COMMITS,promote:true}
  ]){
    downstreamCalls=0;stateCalls=0;buildPosts=0;
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:JSON.stringify(invalidBody)}),env,{});
    assert.equal(response.status,400);assert.equal(stateCalls,0);assert.equal(buildPosts,0);
  }

  // Missing Builds API credentials is fail-closed, never a fake candidate.
  {
    const noCf={...env,CLOUDFLARE_BUILDS_API_TOKEN:""};
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:JSON.stringify({branch:"candidate/no-config",commits:COMMITS})}),noCf,{});
    const body=await response.json();
    assert.equal(response.status,503);assert.equal(body.error,"CLOUDFLARE_BUILDS_NOT_CONFIGURED");
  }

  // Unsafe preview trigger (wrangler deploy) is rejected before any build is triggered.
  {
    unsafePreview=true;buildPosts=0;
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:JSON.stringify({branch:"candidate/unsafe",commits:COMMITS})}),env,{});
    const body=await response.json();
    assert.equal(response.status,503);assert.equal(body.error,"SAFE_PREVIEW_TRIGGER_NOT_FOUND");assert.equal(buildPosts,0);
    unsafePreview=false;
  }

  // A later trigger failure cancels already-triggered preview builds best-effort.
  {
    failTriggerCenter="compute";buildPosts=0;cancelPuts=0;
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:JSON.stringify({branch:"candidate/partial",commits:COMMITS})}),env,{});
    const body=await response.json();
    assert.equal(response.status,503);assert.equal(body.error,"CLOUDFLARE_API_ERROR");assert.equal(buildPosts,2);assert.equal(cancelPuts,2);
    assert.equal(body.details.partial_builds_cancelled.every(x=>x.cancelled===true),true);
    failTriggerCenter=null;
  }

  // Create a real four-build Cloudflare preview candidate pinned to exact commits.
  let candidateId,candidateDigest,acceptanceRunId,acceptanceDigest;
  {
    buildPosts=0;
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:JSON.stringify({branch:"candidate/phase-2",commits:COMMITS,label:"phase-2",reason:"preview build acceptance"})}),env,{}),body=await response.json();
    assert.equal(response.status,202);assert.equal(body.ok,true);assert.equal(body.operation,"createCandidateVersion");
    assert.equal(body.receipt_schema,"three-center-admin-candidate-receipt-v2");
    assert.equal(body.production_write,false);assert.equal(body.data.candidate_kind,"cloudflare-preview-build-set");
    assert.equal(body.data.candidate_state,"BUILDING");assert.equal(body.data.branch,"candidate/phase-2");
    assert.deepEqual(body.data.commits,COMMITS);assert.equal(Object.keys(body.data.build_uuids).length,4);
    assert.equal(body.data.fresh_business_e2e,false);assert.equal(body.data.promotion_eligible,false);
    assert.equal(buildPosts,4);assert.match(body.receipt_digest,/^[a-f0-9]{64}$/);assert.match(body.candidate_digest,/^[a-f0-9]{64}$/);
    candidateId=body.tested_candidate;candidateDigest=body.candidate_digest;
  }

  // Build still running returns PENDING and no final acceptance run_id.
  {
    pendingCenter="compute";
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates/validate",{method:"POST",headers:auth,body:JSON.stringify({candidate_id:candidateId})}),env,{}),body=await response.json();
    assert.equal(response.status,202);assert.equal(body.validation,"PENDING");assert.equal(body.acceptance_final,false);assert.equal(body.run_id,null);assert.equal(body.builds.compute.status,"running");
    pendingCenter=null;
  }

  // All preview builds succeed, exact branch/commit identity holds, and production stayed unchanged.
  {
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates/validate",{method:"POST",headers:auth,body:JSON.stringify({candidate_id:candidateId})}),env,{}),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.validation,"PASS");
    assert.equal(body.receipt_schema,"three-center-admin-acceptance-receipt-v2");
    assert.equal(body.acceptance_scope,"cloudflare-preview-build-control-plane-v1");
    assert.equal(body.fresh_business_e2e,false);assert.equal(body.promotion_eligible,false);
    assert.equal(body.promotion_block_reason,"runtime-canary-not-verified");assert.equal(body.candidate_digest,candidateDigest);
    assert.equal(body.checks.length,13);assert.equal(body.checks.every(x=>x.ok===true),true);
    acceptanceRunId=body.run_id;acceptanceDigest=body.receipt_digest;
  }

  // Terminal acceptance can be queried by run_id and preserves its immutable digest.
  {
    const response=await worker.fetch(new Request(`https://governance.test/v1/admin/acceptance?run_id=${encodeURIComponent(acceptanceRunId)}`,{headers:{authorization:`Bearer ${TOKEN}`}}),env,{}),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.operation,"getAcceptanceResult");
    assert.equal(body.data.acceptance_receipt_digest,acceptanceDigest);assert.equal(body.data.acceptance.receipt_digest,acceptanceDigest);
    assert.equal(body.data.acceptance.validation,"PASS");
  }

  // Production runtime drift after candidate creation is a stored FAIL.
  {
    const create=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:JSON.stringify({branch:"candidate/drift",commits:COMMITS})}),env,{}),created=await create.json();
    versions.compute="compute-v2";
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates/validate",{method:"POST",headers:auth,body:JSON.stringify({candidate_id:created.tested_candidate})}),env,{}),body=await response.json();
    assert.equal(response.status,422);assert.equal(body.validation,"FAIL");
    assert.equal(body.checks.find(x=>x.name==="production_runtime_unchanged")?.ok,false);
    versions.compute="compute-v1";
  }

  // Any preview build failure is a terminal FAIL, not a degraded PASS.
  {
    const create=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:JSON.stringify({branch:"candidate/build-fail",commits:COMMITS})}),env,{}),created=await create.json();
    failedCenter="expert";
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates/validate",{method:"POST",headers:auth,body:JSON.stringify({candidate_id:created.tested_candidate})}),env,{}),body=await response.json();
    assert.equal(response.status,422);assert.equal(body.validation,"FAIL");
    assert.equal(body.checks.find(x=>x.name==="candidate_builds_success")?.ok,false);
    failedCenter=null;
  }

  // Active downstream work blocks candidate build triggering.
  {
    active.expert={task_id:"busy-expert",kind:"expert"};buildPosts=0;
    const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:JSON.stringify({branch:"candidate/busy",commits:COMMITS})}),env,{}),body=await response.json();
    assert.equal(response.status,409);assert.equal(body.error,"ADMIN_BUSY");assert.equal(buildPosts,0);
    active.expert=null;
  }

  // Phase 2 still does not expose promote or rollback; the authenticated provider E2E action is preserved.
  {
    const response=await worker.fetch(new Request("https://governance.test/openapi.json"),env,{}),spec=await response.json(),operationIds=[];
    for(const pathItem of Object.values(spec.paths))for(const operation of Object.values(pathItem))operationIds.push(operation.operationId);
    for(const required of ["runProviderFreshE2E","createCandidateVersion","validateCandidate","getAcceptanceResult"])assert.ok(operationIds.includes(required));
    for(const forbidden of ["promoteCandidate","rollbackProduction"])assert.equal(operationIds.includes(forbidden),false);
    assert.equal(operationIds.length,13);
  }

  console.log(JSON.stringify({ok:true,suite:"governance-admin-candidate-acceptance",candidate_kind:"cloudflare-preview-build-set",acceptance_scope:"cloudflare-preview-build-control-plane-v1",fresh_business_e2e:false,provider_fresh_e2e_action:true,promotion_enabled:false,rollback_enabled:false,total_action_operations:13,runtime_contract_strict:true,safe_preview_only:true}));
} finally {
  globalThis.fetch=originalFetch;
}
