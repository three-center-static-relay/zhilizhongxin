import app from "./production-entry.js";
import {AdminState} from "./admin-state.js";
import {adminOpenApiPaths,createCandidateVersion,getAcceptanceResult,getAdminContext,getProductionVersions,getSystemHealth,validateCandidate} from "./admin-gateway.js";
export {AdminState};

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
function constantTimeEqual(a,b){a=String(a||"");b=String(b||"");if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
function authenticate(request,env){const h=request.headers.get("authorization")||"";if(!h.startsWith("Bearer "))return{ok:false,status:401,error:"UNAUTHORIZED"};if(!env.ADMIN_GPT_TOKEN)return{ok:false,status:503,error:"ADMIN_TOKEN_NOT_CONFIGURED"};return constantTimeEqual(h.slice(7).trim(),env.ADMIN_GPT_TOKEN)?{ok:true}:{ok:false,status:401,error:"UNAUTHORIZED"}}

function modelScopePath(operationId,summary){return{get:{operationId,summary,description:"Authenticated zero-AI live ModelScope selftest through an internal Cloudflare Service Binding. Returns redacted boolean/status fields only and never returns the ModelScope token.",security:[{BearerAuth:[]}],responses:{"200":{description:"ModelScope token and requested read-only capabilities passed."},"401":{description:"Unauthorized."},"503":{description:"Center binding, ModelScope authentication, or one or more required capabilities failed."}}}}}

async function runModelScopeSelftest(request,env,center){
  const auth=authenticate(request,env);if(!auth.ok)return json({ok:false,error:auth.error,http_status:auth.status,center,secrets_redacted:true},auth.status);
  const svc=center==="compute"?env.COMPUTE_CENTER:env.INTELLIGENCE_CENTER;
  if(!svc?.fetch)return json({ok:false,error:"CENTER_UNCONFIGURED",center,http_status:503,secrets_redacted:true},503);
  const origin=center==="compute"?"https://compute.internal":"https://intelligence.internal";
  const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const r=await svc.fetch(new Request(`${origin}/v1/selftest/modelscope-runtime`,{method:"GET",headers:{accept:"application/json"},signal:controller.signal}));
    const body=await r.json().catch(()=>null),ok=r.ok&&body?.ok===true;
    return json({ok,http_status:r.status,center,suite:"modelscope-runtime",selftest:body,secrets_redacted:true,elapsed_ms:Date.now()-started},ok?200:(r.status||503));
  }catch(error){
    const timeout=error?.name==="AbortError";
    return json({ok:false,error:timeout?"SELFTEST_TIMEOUT":"SELFTEST_FAILED",center,suite:"modelscope-runtime",message:String(error?.message||error).slice(0,160),http_status:timeout?504:502,secrets_redacted:true,elapsed_ms:Date.now()-started},timeout?504:502);
  }finally{clearTimeout(timer)}
}

async function openApiWithAdmin(request,env,ctx){
  const response=await app.fetch(request,env,ctx);
  if(!response.ok)return response;
  const spec=await response.json().catch(()=>null);
  if(!spec||typeof spec!=="object")return response;
  return json({...spec,paths:{...(spec.paths||{}),...adminOpenApiPaths()}});
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/v1/intelligence/modelscope-selftest")return runModelScopeSelftest(request,env,"intelligence");
    if(request.method==="GET"&&url.pathname==="/v1/compute/modelscope-selftest")return runModelScopeSelftest(request,env,"compute");
    if(request.method==="GET"&&url.pathname==="/v1/admin/context")return getAdminContext(request,env,ctx,app);
    if(request.method==="GET"&&url.pathname==="/v1/admin/health")return getSystemHealth(request,env,ctx,app);
    if(request.method==="GET"&&url.pathname==="/v1/admin/versions")return getProductionVersions(request,env,ctx,app);
    if(request.method==="POST"&&url.pathname==="/v1/admin/candidates")return createCandidateVersion(request,env,ctx,app);
    if(request.method==="POST"&&url.pathname==="/v1/admin/candidates/validate")return validateCandidate(request,env,ctx,app);
    if(request.method==="GET"&&url.pathname==="/v1/admin/acceptance")return getAcceptanceResult(request,env);
    if(request.method==="GET"&&url.pathname==="/openapi.json")return openApiWithAdmin(request,env,ctx);
    return app.fetch(request,env,ctx);
  }
};
