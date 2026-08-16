import {assistRuntimeIdentity} from "./assist-runtime.js";

const RECEIPT_SCHEMA="three-center-admin-read-receipt-v1";
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

async function receipt(operation,data){
  const run_id=`admin-${operation}-${crypto.randomUUID()}`;
  const observed_at=new Date().toISOString();
  const base={receipt_schema:RECEIPT_SCHEMA,run_id,operation,observed_at,read_only:true,tested_candidate:null,rollback_target:null,data};
  const receipt_digest=await sha256Text(JSON.stringify(base));
  return {...base,receipt_digest};
}

async function authorized(request,env,fn){
  const auth=authenticate(request,env);
  if(!auth.ok)return json({ok:false,error:auth.error},auth.status);
  try{return json(await fn(),200);}catch(error){return json({ok:false,error:String(error?.message||"ADMIN_GATEWAY_FAILED")},500);}
}

export function adminOpenApiPaths(){
  return {
    "/v1/admin/context":{get:{operationId:"getAdminContext",summary:"Read three-center admin context",description:"Read-only snapshot of governance, intelligence, compute and expert centers, including runtime version metadata, source digest, acceptance state and active-task metadata where exposed.",security:[{BearerAuth:[]}],responses:{"200":{description:"Read-only context receipt."},"401":{description:"Unauthorized."},"503":{description:"Admin authentication is not configured."}}}},
    "/v1/admin/health":{get:{operationId:"getSystemHealth",summary:"Read three-center system health",description:"Read-only health snapshot for governance, intelligence, compute and expert centers. Returns a receipt even when one or more centers are degraded, without treating health as acceptance.",security:[{BearerAuth:[]}],responses:{"200":{description:"Read-only health receipt."},"401":{description:"Unauthorized."},"503":{description:"Admin authentication is not configured."}}}},
    "/v1/admin/versions":{get:{operationId:"getProductionVersions",summary:"Read production runtime versions",description:"Read Cloudflare runtime version metadata and source digests for all centers. A center is version-verified only when both runtime version ID and source digest are present.",security:[{BearerAuth:[]}],responses:{"200":{description:"Read-only production-version receipt."},"401":{description:"Unauthorized."},"503":{description:"Admin authentication is not configured."}}}}
  };
}

export async function getAdminContext(request,env,ctx,app){
  return authorized(request,env,async()=>{
    const centers=await collectContexts(app,env,ctx);
    const complete=Object.values(centers).every(c=>c?.ok===true);
    return receipt("getAdminContext",{status:complete?"VERIFIED":"PARTIAL",centers});
  });
}

export async function getSystemHealth(request,env,ctx,app){
  return authorized(request,env,async()=>{
    const centers=await collectContexts(app,env,ctx);
    const health=Object.fromEntries(Object.entries(centers).map(([name,c])=>[name,{ok:centerHealthy(c),health:c?.health||null,active_task:c?.active_task||null,active_state_verified:c?.active_state_verified===true,runtime_version:c?.runtime_version||null}]));
    const allHealthy=Object.values(health).every(x=>x.ok===true);
    return receipt("getSystemHealth",{overall_status:allHealthy?"HEALTHY":"DEGRADED",health,health_is_not_acceptance:true});
  });
}

export async function getProductionVersions(request,env,ctx,app){
  return authorized(request,env,async()=>{
    const centers=await collectContexts(app,env,ctx);
    const current_production=Object.fromEntries(Object.entries(centers).map(([name,c])=>[name,centerVersion(c)]));
    const allVerified=Object.values(current_production).every(x=>x.verified===true);
    return receipt("getProductionVersions",{status:allVerified?"VERIFIED":"PARTIAL",current_production});
  });
}
