import app from "./entry.js";
import {adminOpenApiPaths,getAdminContext,getProductionVersions,getSystemHealth} from "./admin-gateway.js";

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

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
    if(request.method==="GET"&&url.pathname==="/v1/admin/context")return getAdminContext(request,env,ctx,app);
    if(request.method==="GET"&&url.pathname==="/v1/admin/health")return getSystemHealth(request,env,ctx,app);
    if(request.method==="GET"&&url.pathname==="/v1/admin/versions")return getProductionVersions(request,env,ctx,app);
    if(request.method==="GET"&&url.pathname==="/openapi.json")return openApiWithAdmin(request,env,ctx);
    return app.fetch(request,env,ctx);
  }
};
