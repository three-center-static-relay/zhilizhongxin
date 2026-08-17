import app from "./production-entry.js";
import {AdminState} from "./admin-state.js";
import {adminOpenApiPaths,createCandidateVersion,getAcceptanceResult,getAdminContext,getProductionVersions,getSystemHealth,validateCandidate} from "./admin-gateway.js";
export {AdminState};

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const STUDIO_BOOTSTRAP_HEADER="studio-cpu-v1-20260817";

async function openApiWithAdmin(request,env,ctx){
  const response=await app.fetch(request,env,ctx);
  if(!response.ok)return response;
  const spec=await response.json().catch(()=>null);
  if(!spec||typeof spec!=="object")return response;
  return json({...spec,paths:{...(spec.paths||{}),...adminOpenApiPaths()}});
}

function sanitizeStudioBootstrap(body,status){
  const h=body?.hardware&&typeof body.hardware==="object"?body.hardware:null;
  const r=body?.runtime_receipt&&typeof body.runtime_receipt==="object"?body.runtime_receipt:null;
  return {
    ok:body?.ok===true,
    selftest:"modelscope-studio-bootstrap-governed",
    center:"compute",
    upstream_http_status:status,
    stage:body?.stage||null,
    error_class:body?.error_class||null,
    hardware:h?{name:String(h.name||"").slice(0,160),cpu:Number(h.cpu||0),memory_gb:Number(h.memory_gb||0),free:h.free===true}:null,
    runtime_receipt:r?{ok:r.ok===true,revision:String(r.revision||"").slice(0,100),cpu_effective:Number(r.cpu_effective||0),memory_gb_effective:Number(r.memory_gb_effective||0),python:String(r.python||"").slice(0,40),numpy:r.numpy?String(r.numpy).slice(0,80):null,torch:r.torch?String(r.torch).slice(0,80):null,square_sum_correct:r.square_sum_correct===true,result_digest:String(r.result_digest||"").slice(0,64),elapsed_s:Number(r.elapsed_s||0)}:null,
    free_only:body?.free_only===true,
    paid_fallback:body?.paid_fallback===true,
    secrets_redacted:true
  };
}

async function runStudioBootstrapBridge(request,env){
  if(request.headers.get("x-three-center-selftest")!==STUDIO_BOOTSTRAP_HEADER)return json({ok:false,error:"POLICY_DENIED",selftest:"modelscope-studio-bootstrap-governed",secrets_redacted:true},403);
  if(!env.COMPUTE_CENTER?.fetch)return json({ok:false,error:"COMPUTE_BINDING_UNAVAILABLE",selftest:"modelscope-studio-bootstrap-governed",secrets_redacted:true},503);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  try{
    const response=await env.COMPUTE_CENTER.fetch(new Request("https://compute.internal/v1/admin/modelscope/studio-bootstrap",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:"{}",signal:controller.signal}));
    const body=await response.json().catch(()=>({ok:false,error_class:"COMPUTE_BAD_JSON",free_only:true,paid_fallback:false}));
    const out=sanitizeStudioBootstrap(body,response.status);
    const invariant=out.free_only===true&&out.paid_fallback===false;
    return json({...out,ok:out.ok===true&&invariant,invariant_ok:invariant},out.ok===true&&invariant?200:(response.status||503));
  }catch(error){
    const timeout=error?.name==="AbortError";
    return json({ok:false,selftest:"modelscope-studio-bootstrap-governed",center:"compute",error:timeout?"BOOTSTRAP_TIMEOUT":"BOOTSTRAP_FAILED",message:String(error?.message||error).slice(0,160),free_only:true,paid_fallback:false,secrets_redacted:true},timeout?504:502);
  }finally{clearTimeout(timer)}
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="POST"&&url.pathname==="/v1/selftest/modelscope-studio-bootstrap")return runStudioBootstrapBridge(request,env);
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
