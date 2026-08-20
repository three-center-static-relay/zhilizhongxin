import app from "./production-entry.js";
import {AdminState} from "./admin-state.js";
import {adminOpenApiPaths,createCandidateVersion,getAcceptanceResult,getAdminContext,getProductionVersions,getSystemHealth,validateCandidate} from "./admin-gateway.js";
import {handleEvolutionRoute} from "./evolution-router.js";
export {AdminState};

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

async function openApiWithAdmin(request,env,ctx){
  const response=await app.fetch(request,env,ctx);
  if(!response.ok)return response;
  const spec=await response.json().catch(()=>null);
  if(!spec||typeof spec!=="object")return response;
  return json({...spec,paths:{...(spec.paths||{}),...adminOpenApiPaths()}});
}

async function proxyAdminTencent(request,env){
  if(!env.ADMIN_CENTER?.fetch)return json({ok:false,error:"ADMIN_CENTER_UNAVAILABLE"},503);
  const url=new URL(request.url);
  const target=`https://admin.internal${url.pathname}${url.search}`;
  const init={method:request.method,headers:new Headers(request.headers)};
  if(request.method!=="GET"&&request.method!=="HEAD")init.body=await request.arrayBuffer();
  try{
    const upstream=await env.ADMIN_CENTER.fetch(new Request(target,init));
    const headers=new Headers(upstream.headers);headers.set("cache-control","no-store");headers.delete("set-cookie");
    return new Response(upstream.body,{status:upstream.status,headers});
  }catch(error){return json({ok:false,error:"ADMIN_CENTER_PROXY_FAILED",message:String(error?.message||error)},502)}
}

function aiGatewayServiceErrorCode(body,status,error){
  if(error?.name==="AbortError")return"ADMIN_AI_GATEWAY_SERVICE_TIMEOUT";
  const upstream=String(body?.error_code||body?.error||error?.message||"").toUpperCase();
  if(upstream.includes("CF_API_NOT_CONFIGURED"))return"CF_API_NOT_CONFIGURED";
  if(upstream.includes("PERMISSION")||upstream.includes("UNAUTHORIZED")||upstream.includes("FORBIDDEN")||status===401||status===403)return"AI_GATEWAY_CONTROL_PERMISSION";
  if(upstream.includes("NOT_FOUND")||status===404)return"ADMIN_AI_GATEWAY_PROBE_NOT_FOUND";
  if(upstream.includes("TIMEOUT")||status===504)return"ADMIN_AI_GATEWAY_SERVICE_TIMEOUT";
  if(status>=500)return"ADMIN_AI_GATEWAY_SERVICE_UPSTREAM_FAILED";
  return"ADMIN_AI_GATEWAY_SERVICE_FAILED";
}
async function aiGatewayControlRuntimeProbe(request,env){
  if(request.headers.get("x-three-center-selftest")!=="1")return json({ok:false,error:"NOT_FOUND"},404);
  if(!env.ADMIN_CENTER?.fetch)return json({ok:false,selftest:"governance-ai-gateway-control-readonly-v2",binding:false,service_binding:false,transport:"service-binding-fetch",credential_broker:false,routes_readable:false,error_code:"ADMIN_CENTER_UNBOUND",secrets_redacted:true,dynamic_route_mutation:false,expert_called:false},503);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await env.ADMIN_CENTER.fetch(new Request("https://admin.internal/_internal/ai-gateway-credential-read-probe",{method:"GET",headers:{accept:"application/json","x-three-center-selftest":"1"},signal:controller.signal}));
    const body=await response.json().catch(()=>null);
    const brokered=body?.credential_broker_bound===true&&body?.credential_source==="maintenance-worker";
    const safe=response.status===200&&body?.ok===true&&brokered&&body?.routes_readable===true&&body?.dynamic_route_mutation===false&&body?.expert_called===false&&body?.secrets_redacted===true;
    return json({ok:safe,selftest:"governance-ai-gateway-control-readonly-v2",binding:true,service_binding:true,transport:"service-binding-fetch",admin_probe_reached:true,credential_broker:brokered,credential_source:brokered?"maintenance-worker":String(body?.credential_source||""),routes_readable:body?.routes_readable===true,error_code:safe?null:aiGatewayServiceErrorCode(body,response.status),secrets_redacted:true,dynamic_route_mutation:false,expert_called:false},safe?200:502);
  }catch(error){
    return json({ok:false,selftest:"governance-ai-gateway-control-readonly-v2",binding:true,service_binding:true,transport:"service-binding-fetch",admin_probe_reached:false,credential_broker:false,routes_readable:false,error_code:aiGatewayServiceErrorCode(null,0,error),secrets_redacted:true,dynamic_route_mutation:false,expert_called:false},502);
  }finally{clearTimeout(timer)}
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const evolution=await handleEvolutionRoute(request,env,ctx);if(evolution)return evolution;
    if(request.method==="GET"&&url.pathname==="/_internal/ai-gateway-control-readonly-probe")return aiGatewayControlRuntimeProbe(request,env);
    if(request.method==="GET"&&url.pathname==="/v1/admin/context")return getAdminContext(request,env,ctx,app);
    if(request.method==="GET"&&url.pathname==="/v1/admin/health")return getSystemHealth(request,env,ctx,app);
    if(request.method==="GET"&&url.pathname==="/v1/admin/versions")return getProductionVersions(request,env,ctx,app);
    if(request.method==="POST"&&url.pathname==="/v1/admin/candidates")return createCandidateVersion(request,env,ctx,app);
    if(request.method==="POST"&&url.pathname==="/v1/admin/candidates/validate")return validateCandidate(request,env,ctx,app);
    if(request.method==="GET"&&url.pathname==="/v1/admin/acceptance")return getAcceptanceResult(request,env);
    if((request.method==="GET"&&url.pathname==="/v1/admin/tencent/status")||(request.method==="POST"&&(url.pathname==="/v1/admin/tencent/selftest"||url.pathname==="/v1/admin/tencent/agent")))return proxyAdminTencent(request,env);
    if(request.method==="GET"&&url.pathname==="/openapi.json")return openApiWithAdmin(request,env,ctx);
    return app.fetch(request,env,ctx);
  }
};
