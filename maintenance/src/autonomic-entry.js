import app from "./runtime-force-refresh-canary.js";
import {handleAutonomicRequest,runScheduledAutonomicPulse} from "./autonomic-runtime.js";
import {handleAutonomicExpertRecovery} from "./autonomic-expert-recovery.js";
export {MaintenanceState} from "./runtime-force-refresh-canary.js";

export default{
  async fetch(req,env,ctx){
    const recovery=await handleAutonomicExpertRecovery(req,env);
    if(recovery)return recovery;
    const u=new URL(req.url);
    if(req.method==="POST"&&u.pathname==="/v1/maintenance/autonomic")return handleAutonomicRequest(req,env);
    return app.fetch(req,env,ctx);
  },
  async scheduled(controller,env,ctx){
    const baseline=app.scheduled(controller,env,ctx);
    ctx.waitUntil(Promise.resolve(baseline).then(()=>runScheduledAutonomicPulse(env)));
    return baseline;
  }
};
