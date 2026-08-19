import {WorkerEntrypoint} from "cloudflare:workers";
import superguard,{AdminCoordinator} from "./superguard.js";
import {verifyBearer} from "./security.js";
export {AdminCoordinator};
const H={"content-type":"application/json;charset=utf-8","cache-control":"no-store"};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const fail=(c,m,s=409,d)=>json({ok:false,error:c,message:m,...(d?{details:d}:{})},s);
const VERSION_OVERRIDE_HEADER="Cloudflare-Workers-Version-Overrides";
const MAINTENANCE_WORKER="maintenance-worker";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{40}$/i;
const versionId=env=>String(env.CF_VERSION_METADATA?.id||"").trim()||null;
async function auth(req,env){if(!env.ADMIN_GPT_TOKEN)throw Object.assign(new Error("ADMIN_TOKEN_NOT_CONFIGURED"),{status:503});if(!await verifyBearer(req,env.ADMIN_GPT_TOKEN))throw Object.assign(new Error("UNAUTHORIZED"),{status:401})}

async function literatureSelftest(req,env){
  await auth(req,env);
  const svc=env.INTELLIGENCE_CENTER;
  if(!svc?.fetch)return fail("CENTER_UNCONFIGURED","intelligence service binding is not configured",503);
  const started=Date.now(),c=new AbortController(),timer=setTimeout(()=>c.abort(),60000);
  try{
    const r=await svc.fetch(new Request("https://intelligence.internal/v1/selftest/literature",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:"{}",signal:c.signal})),body=await r.json().catch(()=>null),ok=r.ok&&body?.ok===true;
    return json({ok,center:"intelligence",suite:"literature-production-keys",http_status:r.status,business_e2e:body?.business_e2e===true,selftest:body,elapsed_ms:Date.now()-started},ok?200:(r.status||503));
  }catch(e){return fail(e?.name==="AbortError"?"SELFTEST_TIMEOUT":"SELFTEST_FAILED",String(e?.message||e),e?.name==="AbortError"?504:502,{center:"intelligence",suite:"literature-production-keys",elapsed_ms:Date.now()-started})}
  finally{clearTimeout(timer)}
}

function overrideHeader(req){return String(req.headers.get(VERSION_OVERRIDE_HEADER)||"").trim()}
function validRequestId(value){const id=String(value||"").trim();return /^[A-Za-z0-9._:-]{1,128}$/.test(id)?id:null}
function authorizeAcceptance(ctx){
  const props=ctx?.props||{};
  if(props.caller!=="expert-l2-acceptance"||props.capability!=="expert-route-acceptance")throw new Error("ACCEPTANCE_CALLER_NOT_AUTHORIZED");
}
async function fetchMaintenanceControl(req,svc,path,init={}){
  if(typeof svc?.fetch!=="function")throw Object.assign(new Error("MAINTENANCE_CONTROL_FETCH_UNAVAILABLE"),{status:503});
  const headers=new Headers(init.headers||{});
  const override=overrideHeader(req);
  if(override)headers.set(VERSION_OVERRIDE_HEADER,override);
  const response=await svc.fetch(new Request(`https://maintenance.control${path}`,{...init,headers}));
  const body=await response.json().catch(()=>null);
  return{response,body};
}
async function runCandidateRefresh(req,env,requestId){
  const call=await fetchMaintenanceControl(req,env.MAINTENANCE_CONTROL,"/v1/control/expert-route/refresh",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({request_id:requestId})});
  const receipt=call.body||{ok:false,http_status:call.response.status,error:"MAINTENANCE_CONTROL_BAD_RESPONSE"};
  const ok=receipt?.ok===true,status=ok?200:receipt?.http_status===409?409:502;
  return json({ ...receipt, ok, operation:"expert-route-refresh", transport:"fetch-version-override", maintenance_transport:receipt?.transport||null, admin_version:versionId(env) },status);
}

async function l2MaintenanceCandidate(req,env){
  const nonce=String(env.L2_ACCEPTANCE_NONCE||""),expiresAt=Number(env.L2_ACCEPTANCE_EXPIRES_AT||0),commit=String(env.L2_ACCEPTANCE_COMMIT||"").trim();
  if(!nonce||!Number.isFinite(expiresAt)||Date.now()>expiresAt||!SHA.test(commit))return fail("NOT_FOUND","Not found",404);
  if(!await verifyBearer(req,nonce))return fail("UNAUTHORIZED","Unauthorized",401);
  const body=await req.json().catch(()=>({})),requestId=validRequestId(body.request_id),adminVersion=String(body.admin_version||"").trim(),maintenanceVersion=String(body.maintenance_version||"").trim();
  if(!requestId||body.commit_sha!==commit||!UUID.test(adminVersion)||!UUID.test(maintenanceVersion))return fail("INVALID_REQUEST","L2 request contract is invalid",400);
  const currentAdminVersion=versionId(env);
  if(currentAdminVersion!==adminVersion)return fail("ADMIN_VERSION_MISMATCH","Admin runtime version mismatch",409,{expected:adminVersion,observed:currentAdminVersion});
  const override=`${MAINTENANCE_WORKER}="${maintenanceVersion}"`;
  const driverRequest=new Request(req.url,{headers:{[VERSION_OVERRIDE_HEADER]:override}});
  const call=await fetchMaintenanceControl(driverRequest,env.MAINTENANCE_CONTROL,"/v1/control/expert-route/refresh",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({request_id:requestId})});
  const receipt=call.body||{ok:false,http_status:call.response.status,error:"MAINTENANCE_CONTROL_BAD_RESPONSE"};
  const result=receipt?.result||null,routeFamily=Array.isArray(result?.route_family)?result.route_family:[],lanes=Array.isArray(result?.company_lanes)?result.company_lanes:[];
  const companies=lanes.map(lane=>String(lane?.company||"")).filter(Boolean);
  const checks={
    admin_version_exact:currentAdminVersion===adminVersion,
    maintenance_version_override_exact:receipt?.maintenance_version===maintenanceVersion,
    route_family_eight:routeFamily.length===8,
    company_lanes_eight:lanes.length===8&&new Set(companies).size===8,
    expert_selftest_ok:result?.selftest?.ok===true,
    company_diverse:result?.selftest?.company_diverse===true,
    route_rollback_ok:receipt?.rollback_rehearsal?.ok===true
  };
  const ok=call.response.ok&&receipt?.ok===true&&Object.values(checks).every(Boolean);
  return json({ok,request_id:requestId,commit_sha:commit,admin_version:currentAdminVersion,maintenance_version:receipt?.maintenance_version||null,checks,result,rollback_rehearsal:receipt?.rollback_rehearsal||null,error:ok?null:receipt?.error||"L2_ACCEPTANCE_CONTRACT_FAILED",secrets_redacted:true},ok?200:502);
}

async function expertRouteRefresh(req,env){
  await auth(req,env);
  const svc=env.MAINTENANCE_CONTROL;
  const body=await req.json().catch(()=>({})),requestId=validRequestId(body.request_id||crypto.randomUUID());
  if(!requestId)return fail("INVALID_REQUEST","request_id format is invalid",400);
  const started=Date.now(),override=overrideHeader(req);
  try{
    let receipt,transport;
    if(override){
      const call=await fetchMaintenanceControl(req,svc,"/v1/control/expert-route/refresh",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({request_id:requestId})});
      receipt=call.body||{ok:false,http_status:call.response.status,error:"MAINTENANCE_CONTROL_BAD_RESPONSE"};
      transport="fetch-version-override";
    }else{
      if(typeof svc?.refreshExpertRoute!=="function")return fail("MAINTENANCE_CONTROL_UNCONFIGURED","maintenance RPC control binding is not configured",503);
      receipt=await svc.refreshExpertRoute(requestId);
      transport="rpc";
    }
    const ok=receipt?.ok===true,status=ok?200:receipt?.http_status===409?409:502;
    return json({ ...receipt, ok, operation:"expert-route-refresh", transport, maintenance_transport:receipt?.transport||null, admin_version:versionId(env), elapsed_ms:Date.now()-started },status);
  }catch(e){return fail("MAINTENANCE_CONTROL_FAILED",String(e?.message||e),e?.status||502,{operation:"expert-route-refresh",request_id:requestId,admin_version:versionId(env),elapsed_ms:Date.now()-started})}
}

async function expertRouteLatest(req,env){
  await auth(req,env);
  const svc=env.MAINTENANCE_CONTROL,override=overrideHeader(req);
  try{
    let receipt,transport;
    if(override){
      const call=await fetchMaintenanceControl(req,svc,"/v1/control/expert-route/latest",{method:"GET",headers:{accept:"application/json"}});
      receipt=call.body||{ok:false,http_status:call.response.status,error:"MAINTENANCE_CONTROL_BAD_RESPONSE"};
      transport="fetch-version-override";
    }else{
      if(typeof svc?.latestExpertRoute!=="function")return fail("MAINTENANCE_CONTROL_UNCONFIGURED","maintenance RPC control binding is not configured",503);
      receipt=await svc.latestExpertRoute();
      transport="rpc";
    }
    return json({ ...receipt, ok:receipt?.ok===true, operation:"expert-route-latest", transport, maintenance_transport:receipt?.transport||null, admin_version:versionId(env) },receipt?.ok===true?200:502);
  }catch(e){return fail("MAINTENANCE_CONTROL_FAILED",String(e?.message||e),e?.status||502,{operation:"expert-route-latest",admin_version:versionId(env)})}
}

export class AdminAcceptanceControl extends WorkerEntrypoint{
  async fetch(request){
    authorizeAcceptance(this.ctx);
    const url=new URL(request.url);
    if(request.method==="POST"&&url.pathname==="/v1/control/expert-route/refresh"){
      const body=await request.json().catch(()=>({})),requestId=validRequestId(body.request_id);
      if(!requestId)return json({ok:false,error:"INVALID_REQUEST_ID",admin_version:versionId(this.env),secrets_redacted:true},400);
      try{return await runCandidateRefresh(request,this.env,requestId)}
      catch(error){return json({ok:false,error:String(error?.message||error),admin_version:versionId(this.env),secrets_redacted:true},502)}
    }
    return json({ok:false,error:"NOT_FOUND",admin_version:versionId(this.env),secrets_redacted:true},404);
  }
}

export default{async fetch(req,env,ctx){try{const u=new URL(req.url);if(req.method==="POST"&&u.pathname==="/v1/admin/l2/maintenance-candidate")return await l2MaintenanceCandidate(req,env);if(req.method==="POST"&&u.pathname==="/v1/admin/selftest/literature")return await literatureSelftest(req,env);if(req.method==="POST"&&u.pathname==="/v1/admin/maintenance/expert-route/refresh")return await expertRouteRefresh(req,env);if(req.method==="GET"&&u.pathname==="/v1/admin/maintenance/expert-route/latest")return await expertRouteLatest(req,env);return await superguard.fetch(req,env,ctx)}catch(e){return fail(String(e?.message||"INTERNAL_ERROR"),e?.status>=500?"Internal operation failed":String(e?.message||"Request failed"),e?.status||500,e?.details)}}};
