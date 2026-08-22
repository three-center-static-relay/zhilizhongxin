import app from "./index.js";
import {buildExpertRoutePlan,refreshExpertRoutes} from "./expert-route-manager.js";
export {MaintenanceState} from "./index.js";

const ENDPOINT="/__runtime-canary/force-route-refresh-v15/L9mR4xN7vK2sP8cT5hW1yF6dB0uGzA3eC7nM4jQ8";
const EXPIRES_AT=Date.parse("2026-08-22T06:30:00.000Z");
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

async function expertIdle(env){
  if(!env.EXPERT_CENTER?.fetch)return false;
  const r=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/admin/context",{headers:{accept:"application/json"}}));
  const body=await r.json().catch(()=>null);
  return r.ok&&body?.ok===true&&!body?.active_task;
}

export default{
  async fetch(req,env,ctx){
    const u=new URL(req.url);
    if(u.pathname===ENDPOINT){
      if(!["POST","GET"].includes(req.method)||Date.now()>EXPIRES_AT)return json({ok:false,error:"NOT_FOUND"},404);
      if(!await expertIdle(env))return json({ok:false,error:"EXPERT_BUSY_OR_CONTEXT_UNAVAILABLE"},409);
      try{
        const plan=await buildExpertRoutePlan(env,fetch);
        const receipt=await refreshExpertRoutes(env,fetch,plan);
        return json({ok:true,selftest:"force-route-refresh-v15-post280",routing_fingerprint:plan.routing_fingerprint,plan_digest:plan.plan_digest,candidate_count:plan.summary?.candidate_count||0,company_count:plan.summary?.company_count||0,effective_model_timeout_ms:plan.summary?.effective_model_timeout_ms||null,fallback_budget_policy:plan.summary?.fallback_budget_policy||null,provider_execution_status:plan.summary?.provider_execution_status||{},runtime_quarantine_count:plan.summary?.runtime_quarantine_count||0,runtime_quarantine_reason:plan.summary?.runtime_quarantine_reason||null,lanes:plan.summary?.lanes||[],route_family:receipt.route_family||[],secrets_redacted:true});
      }catch(error){
        return json({ok:false,error:String(error?.message||error).slice(0,160),details:error?.details||null,secrets_redacted:true},502);
      }
    }
    return app.fetch(req,env,ctx);
  },
  async scheduled(controller,env,ctx){return app.scheduled(controller,env,ctx)}
};
