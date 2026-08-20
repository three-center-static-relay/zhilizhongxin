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

function aiGatewayRpcErrorCode(error){
  const message=String(error?.message||error||"").toUpperCase();
  if(message.includes("CF_API_NOT_CONFIGURED"))return"CF_API_NOT_CONFIGURED";
  if(message.includes("AI_GATEWAY_CONTROL_GATEWAY_MISMATCH"))return"AI_GATEWAY_CONTROL_GATEWAY_MISMATCH";
  if(message.includes("AI_GATEWAY_CONTROL_UPSTREAM_401")||message.includes("AI_GATEWAY_CONTROL_UPSTREAM_403")||message.includes("UNAUTHORIZED")||message.includes("FORBIDDEN"))return"AI_GATEWAY_CONTROL_PERMISSION";
  if(message.includes("AI_GATEWAY_CONTROL_UPSTREAM_404"))return"AI_GATEWAY_CONTROL_UPSTREAM_NOT_FOUND";
  if(message.includes("ENTRYPOINT")||message.includes("NOT FOUND"))return"AI_GATEWAY_CONTROL_ENTRYPOINT_UNAVAILABLE";
  if(message.includes("TIMEOUT"))return"AI_GATEWAY_CONTROL_TIMEOUT";
  return"AI_GATEWAY_CONTROL_RPC_FAILED";
}
function safeRpcErrorName(error){
  const name=String(error?.name||"");
  return ["Error","TypeError","DOMException"].includes(name)?name:"OtherError";
}
async function aiGatewayControlRuntimeProbe(request,env){
  if(request.headers.get("x-three-center-selftest")!=="1")return json({ok:false,error:"NOT_FOUND"},404);
  if(!env.AI_GATEWAY_CONTROL?.request)return json({ok:false,selftest:"governance-ai-gateway-control-readonly-v1",binding:false,broker_rpc:false,routes_readable:false,error_code:"AI_GATEWAY_CONTROL_UNBOUND",secrets_redacted:true,dynamic_route_mutation:false,expert_called:false},503);
  let timer;
  try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("AI_GATEWAY_CONTROL_TIMEOUT")),8000)});
    const payload=await Promise.race([env.AI_GATEWAY_CONTROL.request({operation:"routes.list"}),timeout]);
    const success=payload?.success!==false;
    return json({ok:success,selftest:"governance-ai-gateway-control-readonly-v1",binding:true,broker_rpc:true,routes_readable:success,error_code:success?null:"AI_GATEWAY_CONTROL_READ_FAILED",secrets_redacted:true,dynamic_route_mutation:false,expert_called:false},success?200:502);
  }catch(error){
    return json({ok:false,selftest:"governance-ai-gateway-control-readonly-v1",binding:true,broker_rpc:false,routes_readable:false,error_code:aiGatewayRpcErrorCode(error),error_name:safeRpcErrorName(error),secrets_redacted:true,dynamic_route_mutation:false,expert_called:false},502);
  }finally{if(timer)clearTimeout(timer)}
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
