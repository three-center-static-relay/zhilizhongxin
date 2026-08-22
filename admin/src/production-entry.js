import handler,{AdminCoordinator} from "./production-superguard.js";
import {WorkerEntrypoint} from "cloudflare:workers";
import {aiGatewayControlRequest,operationRequest} from "./ai-gateway-control.js";
import {handleLangGraphControl} from "./langgraph-control.js";
import {handleLangGraphTest} from "./langgraph-test.js";
import {handleRuntimeAdaptiveRerunV6} from "./runtime-adaptive-rerun-v6.js";
import {handleAutonomicExpertE2EV20} from "./autonomic-expert-e2e-v20.js";
import {handleFuzhouFiveWayV21} from "./runtime-fuzhou-five-way-v21.js";

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
    const fiveWay=await handleFuzhouFiveWayV21(request,env,ctx);
    if(fiveWay)return fiveWay;
    const autonomicE2E=await handleAutonomicExpertE2EV20(request,env,ctx);
    if(autonomicE2E)return autonomicE2E;
    const rerun=await handleRuntimeAdaptiveRerunV6(request,env,ctx);
    if(rerun)return rerun;
    const langgraph=await handleLangGraphControl(request,env);
    if(langgraph)return langgraph;
    const langgraphTest=await handleLangGraphTest(request,env);
    if(langgraphTest)return langgraphTest;
    const probe=await credentialReadProbe(request,env);
    if(probe)return probe;
    return handler.fetch(request,env,ctx);
  }
};
