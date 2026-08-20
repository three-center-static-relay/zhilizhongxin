import handler,{AdminCoordinator} from "./production-superguard.js";
import {WorkerEntrypoint} from "cloudflare:workers";
import {aiGatewayControlRequest} from "./ai-gateway-control.js";

export {AdminCoordinator};

export class AIGatewayControl extends WorkerEntrypoint {
  async request(input){
    return aiGatewayControlRequest(this.env,input);
  }
}

export default handler;
