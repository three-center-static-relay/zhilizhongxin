import {assistRuntimeIdentity} from "./assist-runtime.js";
import {inspectCandidateBuilds,triggerCandidateBuilds} from "./cloudflare-builds.js";

const READ_RECEIPT_SCHEMA="three-center-admin-read-receipt-v1";
const CANDIDATE_RECEIPT_SCHEMA="three-center-admin-candidate-receipt-v2";
const ACCEPTANCE_RECEIPT_SCHEMA="three-center-admin-acceptance-receipt-v2";
const ACCEPTANCE_SCOPE="cloudflare-preview-build-control-plane-v1";
const MAX_BODY_BYTES=16384;
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

function constantTimeEqual(a,b){
  a=String(a||"");b=String(b||"");
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}

function authenticate(request,env){
  const authorization=request.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))return {ok:false,status:401,error:"UNAUTHORIZED"};
  if(!env.ADMIN_GPT_TOKEN)return {ok:false,status:503,error:"ADMIN_TOKEN_NOT_CONFIGURED"};
  const token=authorization.slice(7).trim();
  if(!constantTimeEqual(token,env.ADMIN_GPT_TOKEN))return {ok:false,status:401,error:"UNAUTHORIZED"};
  return {ok:true};
}

async function parseBody(request,allowedKeys){
  const declared=Number(request.headers.get("content-length")||0);
  if(declared>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  const text=await request.text();
  if(new TextEncoder().encode(text).length>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  if(!text)return{};
  let body;try{body=JSON.parse(text)}catch{throw Object.assign(new Error("INVALID_REQUEST"),{status:400})}
  if(!body||typeof body!=="object"||Array.isArray(body))throw Object.assign(new Error("INVALID_REQUEST"),{status:400});
  for(const key of Object.keys(body))if(!allowedKeys.has(key))throw Object.assign(new Error("UNKNOWN_FIELD"),{status:400});
  return body;
}
function optionalString(body,key,max){
  const value=body[key];if(value===undefined)return null;
  if(typeof value!=="string"||value.length>max)throw Object.assign(new Error("INVALID_REQUEST"),{status:400});
  return value.trim();
}
function requiredString(body,key,max){
  const value=body[key];
  if(typeof value!=="string"||!value.trim()||value.length>max)throw Object.assign(new Error("INVALID_REQUEST"),{status:400});
  return value.trim();
}
function candidateInput(body){
  const branch=requiredString(body,"branch",200);
  if(branch==="main"||/\s/.test(branch))throw Object.assign(new Error("INVALID_CANDIDATE_BRANCH"),{status:400});
  const commits=body.commits;
  if(!commits||typeof commits!=="object"||Array.isArray(commits))throw Object.assign(new Error("INVALID_REQUEST"),{status:400});
  const allowed=new Set(["governance","intelligence","compute","expert"]);
  for(const key of Object.keys(commits))if(!allowed.has(key))throw Object.assign(new Error("UNKNOWN_FIELD"),{status:400});
  const normalized={};
  for(const center of allowed){
    const sha=String(commits[center]||"").trim().toLowerCase();
    if(!/^[a-f0-9]{40}$/.test(sha))throw Object.assign(new Error("INVALID_COMMIT_SHA"),{status:400});
    normalized[center]=sha;
  }
  return {branch,commits:normalized};
}

async function sha256Text(text){
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(text)));
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

async function readJson(response){
  const body=await response.json().catch(()=>({ok:false,error:"ADMIN_BAD_JSON"}));
  return {http_status:response.status,body};
}

async function localRead(app,path,env,ctx){
  try{return await readJson(await app.fetch(new Request(`https://governance.internal${path}`,{method:"GET"}),env,ctx));}
  catch(error){return {http_status:0,body:{ok:false,error:String(error?.message||"LOCAL_ADMIN_READ_FAILED")}};}
}

async function serviceRead(binding,origin,path){
  if(!binding?.fetch)return {http_status:0,body:{ok:false,error:"SERVICE_BINDING_UNAVAILABLE"}};
  try{return await readJson(await binding.fetch(new Request(`${origin}${path}`,{method:"GET",headers:{accept:"application/json"}})));}
  catch(error){return {http_status:0,body:{ok:false,error:String(error?.message||"SERVICE_BINDING_READ_FAILED")}};}
}

async function governanceContext(app,env,ctx){
  const health=await localRead(app,"/health",env,ctx);
  const source=await localRead(app,"/source",env,ctx);
  const acceptance=await localRead(app,"/v1/acceptance/latest",env,ctx);
  const version=env.CF_VERSION_METADATA||{};
  const ok=health.http_status===200&&health.body?.ok===true&&source.http_status===200&&source.body?.ok===true;
  return {
    ok,
    service:"governance-worker",
    admin_read_only:true,
    observed_at:new Date().toISOString(),
    runtime_version:{id:version.id||null,tag:version.tag||null,timestamp:version.timestamp||null},
    health:health.body,
    source:source.body,
    acceptance:acceptance.body,
    active_task:null,
    active_state_verified:false,
    assist_runtime:assistRuntimeIdentity(),
    secrets_redacted:true
  };
}

async function downstreamContext(binding,origin){
  const result=await serviceRead(binding,origin,"/v1/admin/context");
  if(result.http_status===200&&result.body?.ok===true)return result.body;
  return {
    ok:false,
    admin_read_only:true,
    observed_at:new Date().toISOString(),
    runtime_version:{id:null,tag:null,timestamp:null},
    health:null,
    source:null,
    acceptance:null,
    active_task:null,
    active_state_verified:false,
    error:result.body?.error||"DOWNSTREAM_ADMIN_CONTEXT_FAILED",
    http_status:result.http_status,
    secrets_redacted:true
  };
}

async function collectContexts(app,env,ctx){
  const governance=await governanceContext(app,env,ctx);
  const intelligence=await downstreamContext(env.INTELLIGENCE_CENTER,"https://intelligence.internal");
  const compute=await downstreamContext(env.COMPUTE_CENTER,"https://compute.internal");
  const expert=await downstreamContext(env.EXPERT_CENTER,"https://expert.internal");
  return {governance,intelligence,compute,expert};
}

function centerHealthy(center){return center?.ok===true&&center?.health?.ok===true;}
function centerVersion(center){
  const v=center?.runtime_version||{},s=center?.source||{};
  const runtimeVersionId=v.id||null,sourceDigest=s.source_digest||null;
  return {
    service:center?.service||s.service||center?.health?.service||null,
    runtime_version_id:runtimeVersionId,
    version_tag:v.tag||null,
    version_timestamp:v.timestamp||null,
    api_version:s.api_version||center?.health?.api_version||null,
    source_digest:sourceDigest,
    verified:Boolean(runtimeVersionId&&sourceDigest)
  };
}
function productionSnapshot(centers){return Object.fromEntries(Object.entries(centers).map(([name,c])=>[name,centerVersion(c)]));}
function downstreamIdleState(centers){
  const names=["intelligence","compute","expert"];
  return {
    state_verified:names.every(name=>centers[name]?.active_state_verified===true),
    idle:names.every(name=>centers[name]?.active_state_verified===true&&!centers[name]?.active_task),
    active:Object.fromEntries(names.map(name=>[name,centers[name]?.active_task||null]))
  };
}
function sameVersionSnapshot(a,b){
  const names=["governance","intelligence","compute","expert"];
  return names.every(name=>String(a?.[name]?.runtime_version_id||"")===String(b?.[name]?.runtime_version_id||""));
}
function sameSourceSnapshot(a,b){
  const names=["governance","intelligence","compute","expert"];
  return names.every(name=>String(a?.[name]?.source_digest||"")===String(b?.[name]?.source_digest||""));
}

async function readReceipt(operation,data){
  const run_id=`admin-${operation}-${crypto.randomUUID()}`;
  const observed_at=new Date().toISOString();
  const base={ok:true,http_status:200,receipt_schema:READ_RECEIPT_SCHEMA,run_id,operation,observed_at,read_only:true,tested_candidate:null,rollback_target:null,data};
  const receipt_digest=await sha256Text(JSON.stringify(base));
  return {...base,receipt_digest};
}

async function candidateReceipt(candidate){
  const run_id=`admin-createCandidateVersion-${crypto.randomUUID()}`,observed_at=new Date().toISOString();
  const build_uuids=Object.fromEntries(Object.entries(candidate.manifest.builds).map(([name,b])=>[name,b.build_uuid]));
  const base={
    ok:true,http_status:202,receipt_schema:CANDIDATE_RECEIPT_SCHEMA,run_id,operation:"createCandidateVersion",observed_at,
    production_write:false,admin_metadata_write:true,tested_candidate:candidate.candidate_id,rollback_target:null,
    candidate_digest:candidate.candidate_digest,
    data:{
      candidate_id:candidate.candidate_id,candidate_kind:candidate.manifest.candidate_kind,candidate_state:"BUILDING",
      created_at:candidate.manifest.created_at,branch:candidate.manifest.branch,commits:candidate.manifest.commits,build_uuids,
      production_snapshot_before:candidate.manifest.production_snapshot_before,fresh_business_e2e:false,promotion_eligible:false,
      promotion_block_reason:"runtime-canary-not-verified"
    }
  };
  return {...base,receipt_digest:await sha256Text(JSON.stringify(base))};
}

async function pendingValidationReceipt(candidate,buildInspection){
  const observed_at=new Date().toISOString();
  const base={
    ok:true,http_status:202,receipt_schema:ACCEPTANCE_RECEIPT_SCHEMA,run_id:null,operation:"validateCandidate",observed_at,
    tested_candidate:candidate.candidate_id,candidate_digest:candidate.candidate_digest,validation:"PENDING",
    acceptance_final:false,acceptance_scope:ACCEPTANCE_SCOPE,fresh_business_e2e:false,promotion_eligible:false,
    promotion_block_reason:"candidate-builds-still-running",builds:buildInspection.states,rollback_target:null
  };
  return {...base,receipt_digest:await sha256Text(JSON.stringify(base))};
}

async function acceptanceReceipt({candidate,checks,currentProduction,builds,startedAt}){
  const pass=checks.every(x=>x.ok===true),completed_at=new Date().toISOString(),run_id=`acc-${crypto.randomUUID()}`;
  const base={
    ok:pass,http_status:pass?200:422,receipt_schema:ACCEPTANCE_RECEIPT_SCHEMA,run_id,operation:"validateCandidate",
    started_at:startedAt,completed_at,tested_candidate:candidate.candidate_id,candidate_digest:candidate.candidate_digest,
    validation:pass?"PASS":"FAIL",acceptance_final:true,acceptance_scope:ACCEPTANCE_SCOPE,fresh_business_e2e:false,
    promotion_eligible:false,promotion_block_reason:"runtime-canary-not-verified",checks,builds,
    current_production:currentProduction,rollback_target:null
  };
  return {...base,receipt_digest:await sha256Text(JSON.stringify(base))};
}

function stateBinding(env){
  if(!env.ADMIN_STATE?.get||!env.ADMIN_STATE?.idFromName)return null;
  return env.ADMIN_STATE.get(env.ADMIN_STATE.idFromName("global"));
}
async function stateCall(env,path,method="GET",body){
  const stub=stateBinding(env);
  if(!stub?.fetch)return {http_status:503,body:{ok:false,error:"ADMIN_STATE_UNAVAILABLE"}};
  const init={method,headers:{"content-type":"application/json",accept:"application/json"}};
  if(body!==undefined)init.body=JSON.stringify(body);
  try{return await readJson(await stub.fetch(new Request(`https://admin-state.internal${path}`,init)));}
  catch(error){return {http_status:503,body:{ok:false,error:String(error?.message||"ADMIN_STATE_FAILED")}};}
}

async function authorized(request,env,fn){
  const auth=authenticate(request,env);
  if(!auth.ok)return json({ok:false,error:auth.error,http_status:auth.status},auth.status);
  try{return json(await fn(),200);}catch(error){return json({ok:false,error:String(error?.message||"ADMIN_GATEWAY_FAILED"),http_status:error?.status||500,details:error?.details||undefined},error?.status||500);}
}

export function adminOpenApiPaths(){
  return {
    "/v1/admin/context":{get:{operationId:"getAdminContext",summary:"Read three-center admin context",description:"Read-only snapshot of governance, intelligence, compute and expert centers, including runtime version metadata, source digest, acceptance state and active-task metadata where exposed.",security:[{BearerAuth:[]}],responses:{"200":{description:"Read-only context receipt."},"401":{description:"Unauthorized."},"503":{description:"Admin authentication is not configured."}}}},
    "/v1/admin/health":{get:{operationId:"getSystemHealth",summary:"Read three-center system health",description:"Read-only health snapshot for governance, intelligence, compute and expert centers. Returns a receipt even when one or more centers are degraded, without treating health as acceptance.",security:[{BearerAuth:[]}],responses:{"200":{description:"Read-only health receipt."},"401":{description:"Unauthorized."},"503":{description:"Admin authentication is not configured."}}}},
    "/v1/admin/versions":{get:{operationId:"getProductionVersions",summary:"Read production runtime versions",description:"Read Cloudflare runtime version metadata and source digests for all centers. A center is version-verified only when both runtime version ID and source digest are present.",security:[{BearerAuth:[]}],responses:{"200":{description:"Read-only production-version receipt."},"401":{description:"Unauthorized."},"503":{description:"Admin authentication is not configured."}}}},
    "/v1/admin/candidates":{post:{operationId:"createCandidateVersion",summary:"Trigger pinned Cloudflare preview candidate builds",description:"Trigger four non-production Workers Builds pinned to exact Git commits. Only preview triggers using wrangler versions upload are allowed; production traffic is never changed.",security:[{BearerAuth:[]}],requestBody:{required:true,content:{"application/json":{schema:{type:"object",additionalProperties:false,required:["branch","commits"],properties:{branch:{type:"string",minLength:1,maxLength:200},commits:{type:"object",additionalProperties:false,required:["governance","intelligence","compute","expert"],properties:{governance:{type:"string",pattern:"^[A-Fa-f0-9]{40}$"},intelligence:{type:"string",pattern:"^[A-Fa-f0-9]{40}$"},compute:{type:"string",pattern:"^[A-Fa-f0-9]{40}$"},expert:{type:"string",pattern:"^[A-Fa-f0-9]{40}$"}}},label:{type:"string",maxLength:120},reason:{type:"string",maxLength:500}}}}}},responses:{"202":{description:"All four preview builds accepted; candidate is building."},"400":{description:"Invalid branch, commit SHA, or request body."},"401":{description:"Unauthorized."},"409":{description:"A center is active; candidate not triggered."},"503":{description:"Runtime context, admin state, Builds API credentials, or safe preview trigger unavailable."}}}},
    "/v1/admin/candidates/validate":{post:{operationId:"validateCandidate",summary:"Validate Cloudflare preview candidate builds",description:"Check four preview build outcomes, exact branch and commit identity, safe versions-upload commands, and that production versions/source digests stayed unchanged. No runtime E2E is claimed.",security:[{BearerAuth:[]}],requestBody:{required:true,content:{"application/json":{schema:{type:"object",additionalProperties:false,required:["candidate_id"],properties:{candidate_id:{type:"string",minLength:1,maxLength:160}}}}}},responses:{"200":{description:"Preview-build control-plane validation PASS receipt."},"202":{description:"One or more candidate builds are still running."},"400":{description:"Invalid candidate_id."},"401":{description:"Unauthorized."},"404":{description:"Candidate not found."},"422":{description:"Candidate validation failed; FAIL receipt stored."},"503":{description:"Admin state, runtime context, or Builds API unavailable."}}}},
    "/v1/admin/acceptance":{get:{operationId:"getAcceptanceResult",summary:"Read a stored candidate acceptance result",description:"Read a stored terminal candidate validation receipt by run_id. This does not create deployment, promotion, rollback, or fresh business-E2E state.",security:[{BearerAuth:[]}],parameters:[{name:"run_id",in:"query",required:true,schema:{type:"string",minLength:1,maxLength:200}}],responses:{"200":{description:"Stored acceptance result and receipt digest."},"400":{description:"Valid run_id required."},"401":{description:"Unauthorized."},"404":{description:"Acceptance result not found."},"503":{description:"Admin state unavailable."}}}}
  };
}

export async function getAdminContext(request,env,ctx,app){
  return authorized(request,env,async()=>{
    const centers=await collectContexts(app,env,ctx);
    const complete=Object.values(centers).every(c=>c?.ok===true);
    return readReceipt("getAdminContext",{status:complete?"COMPLETE":"PARTIAL",centers,context_is_not_acceptance:true});
  });
}

export async function getSystemHealth(request,env,ctx,app){
  return authorized(request,env,async()=>{
    const centers=await collectContexts(app,env,ctx);
    const health=Object.fromEntries(Object.entries(centers).map(([name,c])=>[name,{ok:centerHealthy(c),health:c?.health||null,active_task:c?.active_task||null,active_state_verified:c?.active_state_verified===true,runtime_version:c?.runtime_version||null}]));
    const allHealthy=Object.values(health).every(x=>x.ok===true);
    return readReceipt("getSystemHealth",{overall_status:allHealthy?"HEALTHY":"DEGRADED",health,health_is_not_acceptance:true});
  });
}

export async function getProductionVersions(request,env,ctx,app){
  return authorized(request,env,async()=>{
    const centers=await collectContexts(app,env,ctx),current_production=productionSnapshot(centers);
    const allVerified=Object.values(current_production).every(x=>x.verified===true);
    return readReceipt("getProductionVersions",{status:allVerified?"VERIFIED":"PARTIAL",current_production});
  });
}

export async function createCandidateVersion(request,env,ctx,app){
  const auth=authenticate(request,env);if(!auth.ok)return json({ok:false,error:auth.error,http_status:auth.status},auth.status);
  try{
    const body=await parseBody(request,new Set(["branch","commits","label","reason"]));
    const target=candidateInput(body),label=optionalString(body,"label",120),reason=optionalString(body,"reason",500);
    const centers=await collectContexts(app,env,ctx),complete=Object.values(centers).every(c=>c?.ok===true),currentProduction=productionSnapshot(centers),allVersionsVerified=Object.values(currentProduction).every(x=>x.verified===true),idle=downstreamIdleState(centers);
    if(!complete||!allVersionsVerified||!idle.state_verified)return json({ok:false,error:"CANDIDATE_BASELINE_NOT_VERIFIABLE",http_status:503,context_complete:complete,versions_verified:allVersionsVerified,active_state_verified:idle.state_verified},503);
    if(!idle.idle)return json({ok:false,error:"ADMIN_BUSY",http_status:409,active_tasks:idle.active},409);
    const triggered=await triggerCandidateBuilds(env,target);
    const candidate_id=`candidate-${crypto.randomUUID()}`,created_at=new Date().toISOString();
    const manifest={
      candidate_id,candidate_kind:"cloudflare-preview-build-set",created_at,label,reason,
      branch:triggered.branch,commits:triggered.commits,builds:triggered.builds,
      production_snapshot_before:currentProduction,fresh_business_e2e:false,production_mutation:false,promotion_eligible:false
    };
    const candidate_digest=await sha256Text(JSON.stringify(manifest)),record={candidate_id,manifest,candidate_digest,status:"building",latest_acceptance_run_id:null,latest_acceptance_validation:null};
    const stored=await stateCall(env,"/candidate","POST",{candidate_id,record});
    if(stored.http_status!==201||stored.body?.ok!==true)return json({ok:false,error:stored.body?.error||"CANDIDATE_STORE_FAILED",http_status:stored.http_status||503,builds_triggered:true,candidate_untracked:true},stored.http_status||503);
    return json(await candidateReceipt(record),202);
  }catch(error){
    return json({ok:false,error:String(error?.message||"CREATE_CANDIDATE_FAILED"),http_status:error?.status||500,details:error?.details||undefined},error?.status||500);
  }
}

export async function validateCandidate(request,env,ctx,app){
  const auth=authenticate(request,env);if(!auth.ok)return json({ok:false,error:auth.error,http_status:auth.status},auth.status);
  const startedAt=new Date().toISOString();
  try{
    const body=await parseBody(request,new Set(["candidate_id"])),candidateId=requiredString(body,"candidate_id",160);
    const loaded=await stateCall(env,`/candidate/${encodeURIComponent(candidateId)}`);
    if(loaded.http_status===404)return json({ok:false,error:"CANDIDATE_NOT_FOUND",http_status:404},404);
    if(loaded.http_status!==200||loaded.body?.ok!==true)return json({ok:false,error:loaded.body?.error||"ADMIN_STATE_UNAVAILABLE",http_status:loaded.http_status||503},loaded.http_status||503);
    const candidate=loaded.body.candidate,expectedDigest=await sha256Text(JSON.stringify(candidate?.manifest||{}));
    if(candidate?.manifest?.candidate_kind!=="cloudflare-preview-build-set")return json({ok:false,error:"LEGACY_CANDIDATE_NOT_RUNTIME_BUILD",http_status:409},409);
    const buildInspection=await inspectCandidateBuilds(env,candidate.manifest.builds);
    if(buildInspection.pending)return json(await pendingValidationReceipt(candidate,buildInspection),202);

    const centers=await collectContexts(app,env,ctx),complete=Object.values(centers).every(c=>c?.ok===true),currentProduction=productionSnapshot(centers),idle=downstreamIdleState(centers),healthy=Object.values(centers).every(centerHealthy),versionsVerified=Object.values(currentProduction).every(x=>x.verified===true);
    const versionIdentity=sameVersionSnapshot(candidate?.manifest?.production_snapshot_before,currentProduction),sourceIdentity=sameSourceSnapshot(candidate?.manifest?.production_snapshot_before,currentProduction);
    const buildStates=Object.values(buildInspection.states);
    const checks=[
      {name:"candidate_digest_match",ok:Boolean(candidate?.candidate_digest)&&candidate.candidate_digest===expectedDigest,observed:candidate?.candidate_digest===expectedDigest},
      {name:"candidate_builds_terminal",ok:buildStates.every(x=>x.terminal),observed:Object.fromEntries(Object.entries(buildInspection.states).map(([name,x])=>[name,x.status]))},
      {name:"candidate_builds_success",ok:buildStates.every(x=>x.success),observed:Object.fromEntries(Object.entries(buildInspection.states).map(([name,x])=>[name,x.build_outcome]))},
      {name:"candidate_branch_identity",ok:buildStates.every(x=>x.branch_matches),observed:Object.fromEntries(Object.entries(buildInspection.states).map(([name,x])=>[name,x.branch]))},
      {name:"candidate_commit_identity",ok:buildStates.every(x=>x.commit_matches),observed:Object.fromEntries(Object.entries(buildInspection.states).map(([name,x])=>[name,x.commit_hash]))},
      {name:"safe_preview_deploy_commands",ok:buildStates.every(x=>x.safe_preview_deploy),observed:Object.fromEntries(Object.entries(buildInspection.states).map(([name,x])=>[name,x.safe_preview_deploy]))},
      {name:"context_complete",ok:complete,observed:complete},
      {name:"centers_healthy",ok:healthy,observed:healthy},
      {name:"runtime_versions_verified",ok:versionsVerified,observed:versionsVerified},
      {name:"active_states_verified",ok:idle.state_verified,observed:idle.state_verified},
      {name:"centers_idle",ok:idle.idle,observed:idle.active},
      {name:"production_runtime_unchanged",ok:versionIdentity,observed:versionIdentity},
      {name:"production_source_unchanged",ok:sourceIdentity,observed:sourceIdentity}
    ];
    const acceptance=await acceptanceReceipt({candidate,checks,currentProduction,builds:buildInspection.states,startedAt});
    const stored=await stateCall(env,"/acceptance","POST",{run_id:acceptance.run_id,candidate_id:candidateId,record:acceptance});
    if(stored.http_status!==201||stored.body?.ok!==true)return json({ok:false,error:stored.body?.error||"ACCEPTANCE_STORE_FAILED",http_status:stored.http_status||503},stored.http_status||503);
    return json(acceptance,acceptance.http_status);
  }catch(error){
    return json({ok:false,error:String(error?.message||"VALIDATE_CANDIDATE_FAILED"),http_status:error?.status||500,details:error?.details||undefined},error?.status||500);
  }
}

export async function getAcceptanceResult(request,env){
  const auth=authenticate(request,env);if(!auth.ok)return json({ok:false,error:auth.error,http_status:auth.status},auth.status);
  const url=new URL(request.url),raw=url.searchParams.get("run_id");
  if(raw===null||typeof raw!=="string"||!raw.trim()||raw.length>200)return json({ok:false,error:"INVALID_REQUEST",message:"valid run_id required",http_status:400},400);
  const runId=raw.trim(),loaded=await stateCall(env,`/acceptance/${encodeURIComponent(runId)}`);
  if(loaded.http_status===404)return json({ok:false,error:"ACCEPTANCE_NOT_FOUND",http_status:404},404);
  if(loaded.http_status!==200||loaded.body?.ok!==true)return json({ok:false,error:loaded.body?.error||"ADMIN_STATE_UNAVAILABLE",http_status:loaded.http_status||503},loaded.http_status||503);
  const acceptance=loaded.body.acceptance,receipt=await readReceipt("getAcceptanceResult",{query_run_id:runId,acceptance_receipt_digest:acceptance.receipt_digest,acceptance});
  return json(receipt,200);
}
