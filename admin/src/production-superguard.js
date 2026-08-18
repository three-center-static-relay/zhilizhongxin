import superguard,{AdminCoordinator} from "./superguard.js";
import {verifyBearer} from "./security.js";
export {AdminCoordinator};
const H={"content-type":"application/json;charset=utf-8","cache-control":"no-store"};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const fail=(c,m,s=409,d)=>json({ok:false,error:c,message:m,...(d?{details:d}:{})},s);
const VERSION_OVERRIDE_HEADER="Cloudflare-Workers-Version-Overrides";
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

async function fetchMaintenanceControl(req,svc,path,init={}){
  if(typeof svc?.fetch!=="function")throw Object.assign(new Error("MAINTENANCE_CONTROL_FETCH_UNAVAILABLE"),{status:503});
  const headers=new Headers(init.headers||{});
  const override=overrideHeader(req);
  if(override)headers.set(VERSION_OVERRIDE_HEADER,override);
  const response=await svc.fetch(new Request(`https://maintenance.control${path}`,{...init,headers}));
  const body=await response.json().catch(()=>null);
  return{response,body};
}

async function expertRouteRefresh(req,env){
  await auth(req,env);
  const svc=env.MAINTENANCE_CONTROL;
  const body=await req.json().catch(()=>({})),requestId=String(body.request_id||crypto.randomUUID()).trim();
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))return fail("INVALID_REQUEST","request_id format is invalid",400);
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
    return json({ok,operation:"expert-route-refresh",transport,admin_version:versionId(env),...receipt,elapsed_ms:Date.now()-started},status);
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
    return json({ok:receipt?.ok===true,operation:"expert-route-latest",transport,admin_version:versionId(env),...receipt},receipt?.ok===true?200:502);
  }catch(e){return fail("MAINTENANCE_CONTROL_FAILED",String(e?.message||e),e?.status||502,{operation:"expert-route-latest",admin_version:versionId(env)})}
}

export default{async fetch(req,env,ctx){try{const u=new URL(req.url);if(req.method==="POST"&&u.pathname==="/v1/admin/selftest/literature")return await literatureSelftest(req,env);if(req.method==="POST"&&u.pathname==="/v1/admin/maintenance/expert-route/refresh")return await expertRouteRefresh(req,env);if(req.method==="GET"&&u.pathname==="/v1/admin/maintenance/expert-route/latest")return await expertRouteLatest(req,env);return await superguard.fetch(req,env,ctx)}catch(e){return fail(String(e?.message||"INTERNAL_ERROR"),e?.status>=500?"Internal operation failed":String(e?.message||"Request failed"),e?.status||500,e?.details)}}};
