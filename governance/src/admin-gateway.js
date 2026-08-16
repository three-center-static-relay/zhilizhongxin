import {assistRuntimeIdentity} from "./assist-runtime.js";

const READ_RECEIPT_SCHEMA="three-center-admin-read-receipt-v1";
const CANDIDATE_RECEIPT_SCHEMA="three-center-admin-candidate-receipt-v1";
const ACCEPTANCE_RECEIPT_SCHEMA="three-center-admin-acceptance-receipt-v1";
const ACCEPTANCE_SCOPE="control-plane-consistency-v1";
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
  const base={ok:true,http_status:201,receipt_schema:CANDIDATE_RECEIPT_SCHEMA,run_id,operation:"createCandidateVersion",observed_at,production_write:false,admin_metadata_write:true,tested_candidate:candidate.candidate_id,rollback_target:null,candidate_digest:candidate.candidate_digest,data:{candidate_id:candidate.candidate_id,candidate_kind:candidate.manifest.candidate_kind,created_at:candidate.manifest.created_at,production_snapshot:candidate.manifest.production_snapshot,fresh_business_e2e:false,promotion_eligible:false}};
  return {...base,receipt_digest:await sha256Text(JSON.stringify(base))};
}

async function acceptanceReceipt({candidate,checks,currentProduction,startedAt}){
  const pass=checks.every(x=>x.ok===true),completed_at=new Date().toISOString(),run_id=`acc-${crypto.randomUUID()}`;
  const base={ok:pass,http_status:pass?200:422,receipt_schema:ACCEPTANCE_RECEIPT_SCHEMA,run_id,operation:"validateCandidate",started_at:startedAt,completed_at,tested_candidate:candidate.candidate_id,candidate_digest:candidate.candidate_digest,validation:pass?"PASS":"FAIL",acceptance_scope:ACCEPTANCE_SCOPE,fresh_business_e2e:false,promotion_eligible:false,promotion_block_reason:"phase-2-control-plane-only",checks,current_production:currentProduction,rollback_target:null};
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
  try{return json(await fn(),200);}catch(error){return json({ok:false,error:String(error?.message||"ADMIN_GATEWAY_FAILED"),http_status:error?.status||500},error?.status||500);}
}

export function adminOpenApiPaths(){
  return {
    "/v1/admin/context":{get:{operationId:"getAdminContext",summary:"Read three-center admin context",description:"Read-only snapshot of governance, intelligence, compute and expert centers, including runtime version metadata, source digest, acceptance state and active-task metadata where exposed.",security:[{BearerAuth:[]}],responses:{"200":{description:"Read-only context receipt."},"401":{description:"Unauthorized."},"503":{description:"Admin authentication is not configured."}}}},
    "/v1/admin/health":{get:{operationId:"getSystemHealth",summary:"Read three-center system health",description:"Read-only health snapshot for governance, intelligence, compute and expert centers. Returns a receipt even when one or more centers are degraded, without treating health as acceptance.",security:[{BearerAuth:[]}],responses:{"200":{description:"Read-only health receipt."},"401":{description:"Unauthorized."},"503":{description:"Admin authentication is not configured."}}}},
    "/v1/admin/versions":{get:{operationId:"getProductionVersions",summary:"Read production runtime versions",description:"Read Cloudflare runtime version metadata and source digests for all centers. A center is version-verified only when both runtime version ID and source digest are present.",security:[{BearerAuth:[]}],responses:{"200":{description:"Read-only production-version receipt."},"401":{description:"Unauthorized."},"503":{description:"Admin authentication is not configured."}}}},
    "/v1/admin/candidates":{post:{operationId:"createCandidateVersion",summary:"Create an immutable control-plane candidate snapshot",description:"Store an immutable snapshot of the four current production runtime versions and source digests. This writes admin metadata only; it never deploys, promotes, rolls back, or runs paid tests.",security:[{BearerAuth:[]}],requestBody:{required:false,content:{"application/json":{schema:{type:"object",additionalProperties:false,properties:{label:{type:"string",maxLength:120},reason:{type:"string",maxLength:500}}}}}},responses:{"201":{description:"Candidate snapshot created with candidate and receipt digests."},"400":{description:"Invalid request body."},"401":{description:"Unauthorized."},"409":{description:"A center is active; stable snapshot not created."},"503":{description:"Runtime context or admin state is incomplete."}}}},
    "/v1/admin/candidates/validate":{post:{operationId:"validateCandidate",summary:"Validate a stored candidate snapshot",description:"Validate candidate digest, four-center health, idle state, runtime-version identity and source-digest identity. Scope is control-plane consistency only; fresh business E2E is not claimed.",security:[{BearerAuth:[]}],requestBody:{required:true,content:{"application/json":{schema:{type:"object",additionalProperties:false,required:["candidate_id"],properties:{candidate_id:{type:"string",minLength:1,maxLength:160}}}}}},responses:{"200":{description:"Control-plane candidate validation PASS receipt."},"400":{description:"Invalid candidate_id."},"401":{description:"Unauthorized."},"404":{description:"Candidate not found."},"422":{description:"Candidate validation failed; FAIL receipt was stored."},"503":{description:"Admin state or runtime context unavailable."}}}},
    "/v1/admin/acceptance":{get:{operationId:"getAcceptanceResult",summary:"Read a stored candidate acceptance result",description:"Read a previously stored candidate validation receipt by run_id. The returned query receipt embeds the immutable acceptance receipt and does not create deployment or promotion state.",security:[{BearerAuth:[]}],parameters:[{name:"run_id",in:"query",required:true,schema:{type:"string",minLength:1,maxLength:200}}],responses:{"200":{description:"Stored acceptance result and receipt digest."},"400":{description:"Valid run_id required."},"401":{description:"Unauthorized."},"404":{description:"Acceptance result not found."},"503":{description:"Admin state unavailable."}}}}
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
    const body=await parseBody(request,new Set(["label","reason"])),label=optionalString(body,"label",120),reason=optionalString(body,"reason",500);
    const centers=await collectContexts(app,env,ctx),complete=Object.values(centers).every(c=>c?.ok===true),currentProduction=productionSnapshot(centers),allVersionsVerified=Object.values(currentProduction).every(x=>x.verified===true),idle=downstreamIdleState(centers);
    if(!complete||!allVersionsVerified||!idle.state_verified)return json({ok:false,error:"CANDIDATE_SNAPSHOT_NOT_VERIFIABLE",http_status:503,context_complete:complete,versions_verified:allVersionsVerified,active_state_verified:idle.state_verified},503);
    if(!idle.idle)return json({ok:false,error:"ADMIN_BUSY",http_status:409,active_tasks:idle.active},409);
    const candidate_id=`candidate-${crypto.randomUUID()}`,created_at=new Date().toISOString();
    const manifest={candidate_id,candidate_kind:"production-runtime-snapshot",created_at,label,reason,production_snapshot:currentProduction,fresh_business_e2e:false,production_mutation:false,promotion_eligible:false};
    const candidate_digest=await sha256Text(JSON.stringify(manifest)),record={candidate_id,manifest,candidate_digest,status:"created",latest_acceptance_run_id:null,latest_acceptance_validation:null};
    const stored=await stateCall(env,"/candidate","POST",{candidate_id,record});
    if(stored.http_status!==201||stored.body?.ok!==true)return json({ok:false,error:stored.body?.error||"CANDIDATE_STORE_FAILED",http_status:stored.http_status||503},stored.http_status||503);
    return json(await candidateReceipt(record),201);
  }catch(error){return json({ok:false,error:String(error?.message||"CREATE_CANDIDATE_FAILED"),http_status:error?.status||500},error?.status||500)}
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
    const centers=await collectContexts(app,env,ctx),complete=Object.values(centers).every(c=>c?.ok===true),currentProduction=productionSnapshot(centers),idle=downstreamIdleState(centers),healthy=Object.values(centers).every(centerHealthy),versionsVerified=Object.values(currentProduction).every(x=>x.verified===true);
    const versionIdentity=sameVersionSnapshot(candidate?.manifest?.production_snapshot,currentProduction),sourceIdentity=sameSourceSnapshot(candidate?.manifest?.production_snapshot,currentProduction);
    const checks=[
      {name:"candidate_digest_match",ok:Boolean(candidate?.candidate_digest)&&candidate.candidate_digest===expectedDigest,observed:candidate?.candidate_digest===expectedDigest},
      {name:"context_complete",ok:complete,observed:complete},
      {name:"centers_healthy",ok:healthy,observed:healthy},
      {name:"runtime_versions_verified",ok:versionsVerified,observed:versionsVerified},
      {name:"active_states_verified",ok:idle.state_verified,observed:idle.state_verified},
      {name:"centers_idle",ok:idle.idle,observed:idle.active},
      {name:"runtime_version_identity",ok:versionIdentity,observed:versionIdentity},
      {name:"source_digest_identity",ok:sourceIdentity,observed:sourceIdentity}
    ];
    const acceptance=await acceptanceReceipt({candidate,checks,currentProduction,startedAt});
    const stored=await stateCall(env,"/acceptance","POST",{run_id:acceptance.run_id,candidate_id:candidateId,record:acceptance});
    if(stored.http_status!==201||stored.body?.ok!==true)return json({ok:false,error:stored.body?.error||"ACCEPTANCE_STORE_FAILED",http_status:stored.http_status||503},stored.http_status||503);
    return json(acceptance,acceptance.http_status);
  }catch(error){return json({ok:false,error:String(error?.message||"VALIDATE_CANDIDATE_FAILED"),http_status:error?.status||500},error?.status||500)}
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
