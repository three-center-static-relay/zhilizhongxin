import handler,{AdminCoordinator} from "./production-superguard.js";
import {WorkerEntrypoint} from "cloudflare:workers";
import {aiGatewayControlRequest,operationRequest} from "./ai-gateway-control.js";

export {AdminCoordinator};

async function credentialReadProbe(request,env){
  const url=new URL(request.url);
  if(request.method!=="GET"||url.pathname!=="/_internal/ai-gateway-credential-read-probe")return null;
  if(request.headers.get("x-three-center-selftest")!=="1")return new Response(null,{status:404,headers:{"cache-control":"no-store"}});
  if(!env.AI_GATEWAY_CREDENTIAL_READ?.request)return Response.json({ok:false,selftest:"admin-maintenance-ai-gateway-credential-read-v1",credential_broker_bound:false,routes_readable:false,error_code:"AI_GATEWAY_CREDENTIAL_READ_UNBOUND",dynamic_route_mutation:false,expert_called:false,secrets_redacted:true},{status:503,headers:{"cache-control":"no-store"}});
  try{
    const payload=await env.AI_GATEWAY_CREDENTIAL_READ.request({operation:"routes.list"});
    const readable=payload?.success!==false;
    return Response.json({ok:readable,selftest:"admin-maintenance-ai-gateway-credential-read-v1",credential_broker_bound:true,credential_source:"maintenance-worker",routes_readable:readable,error_code:readable?null:"AI_GATEWAY_CREDENTIAL_READ_FAILED",dynamic_route_mutation:false,expert_called:false,secrets_redacted:true},{status:readable?200:502,headers:{"cache-control":"no-store"}});
  }catch{return Response.json({ok:false,selftest:"admin-maintenance-ai-gateway-credential-read-v1",credential_broker_bound:true,credential_source:"maintenance-worker",routes_readable:false,error_code:"AI_GATEWAY_CREDENTIAL_READ_FAILED",dynamic_route_mutation:false,expert_called:false,secrets_redacted:true},{status:502,headers:{"cache-control":"no-store"}})}
}

async function governanceVersionOverrideProbe(request,env){
  const url=new URL(request.url);
  if(request.method!=="GET"||url.pathname!=="/_internal/governance-version-override-probe")return null;
  if(request.headers.get("x-three-center-selftest")!=="1")return new Response(null,{status:404,headers:{"cache-control":"no-store"}});
  if(!env.GOVERNANCE_CENTER?.fetch)return Response.json({ok:false,selftest:"admin-governance-version-override-proxy-v1",service_binding:false,routes_readable:false,error_code:"GOVERNANCE_CENTER_UNBOUND",dynamic_route_mutation:false,expert_called:false,secrets_redacted:true},{status:503,headers:{"cache-control":"no-store"}});
  const override=request.headers.get("Cloudflare-Workers-Version-Overrides")||"";
  if(!override)return Response.json({ok:false,selftest:"admin-governance-version-override-proxy-v1",service_binding:true,routes_readable:false,error_code:"VERSION_OVERRIDE_REQUIRED",dynamic_route_mutation:false,expert_called:false,secrets_redacted:true},{status:400,headers:{"cache-control":"no-store"}});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await env.GOVERNANCE_CENTER.fetch(new Request("https://governance.internal/_internal/ai-gateway-control-readonly-probe",{method:"GET",headers:{accept:"application/json","x-three-center-selftest":"1","Cloudflare-Workers-Version-Overrides":override},signal:controller.signal}));
    const body=await response.json().catch(()=>null);
    const ok=response.status===200&&body?.ok===true&&body?.selftest==="governance-ai-gateway-control-readonly-v2"&&body?.service_binding===true&&body?.transport==="service-binding-fetch"&&body?.routes_readable===true&&body?.dynamic_route_mutation===false&&body?.expert_called===false&&body?.secrets_redacted===true;
    return Response.json({ok,selftest:"admin-governance-version-override-proxy-v1",service_binding:true,transport:"service-binding-fetch",downstream_selftest:String(body?.selftest||""),routes_readable:body?.routes_readable===true,error_code:ok?null:String(body?.error_code||`HTTP_${response.status}`).slice(0,120),dynamic_route_mutation:false,expert_called:false,secrets_redacted:true},{status:ok?200:502,headers:{"cache-control":"no-store"}});
  }catch(error){return Response.json({ok:false,selftest:"admin-governance-version-override-proxy-v1",service_binding:true,transport:"service-binding-fetch",routes_readable:false,error_code:error?.name==="AbortError"?"GOVERNANCE_OVERRIDE_TIMEOUT":"GOVERNANCE_OVERRIDE_FETCH_FAILED",dynamic_route_mutation:false,expert_called:false,secrets_redacted:true},{status:502,headers:{"cache-control":"no-store"}})}finally{clearTimeout(timer)}
}

export class AIGatewayControl extends WorkerEntrypoint {
  async request(input){
    operationRequest(this.env,input||{});
    if(String(input?.operation||"")==="routes.list"){
      if(!this.env.AI_GATEWAY_CREDENTIAL_READ?.request)throw new Error("AI_GATEWAY_CREDENTIAL_READ_UNBOUND");
      return this.env.AI_GATEWAY_CREDENTIAL_READ.request({operation:"routes.list"});
    }
    return aiGatewayControlRequest(this.env,input);
  }
}

export default{
  async fetch(request,env,ctx){
    const governanceProbe=await governanceVersionOverrideProbe(request,env);
    if(governanceProbe)return governanceProbe;
    const probe=await credentialReadProbe(request,env);
    if(probe)return probe;
    return handler.fetch(request,env,ctx);
  }
};
