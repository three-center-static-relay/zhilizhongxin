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

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const evolution=await handleEvolutionRoute(request,env,ctx);if(evolution)return evolution;
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
