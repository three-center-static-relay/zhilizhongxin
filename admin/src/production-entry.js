import handler,{AdminCoordinator} from "./production-superguard.js";
import {WorkerEntrypoint} from "cloudflare:workers";
import {aiGatewayControlRequest,operationRequest} from "./ai-gateway-control.js";

export {AdminCoordinator};

export class AIGatewayControl extends WorkerEntrypoint {
  async request(input){
    const request=operationRequest(this.env,input||{});
    if(String(input?.operation||"")==="routes.list"){
      if(!this.env.AI_GATEWAY_CREDENTIAL_READ?.request)throw new Error("AI_GATEWAY_CREDENTIAL_READ_UNBOUND");
      return this.env.AI_GATEWAY_CREDENTIAL_READ.request({operation:"routes.list"});
    }
    return aiGatewayControlRequest(this.env,input);
  }
}

export default handler;
