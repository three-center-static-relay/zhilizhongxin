import {runNemotronAdvisory} from "./autonomic-runtime.js";
import {buildExpertRoutePlan,refreshExpertRoutes} from "./expert-route-manager.js";

const ENDPOINT="/__autonomic-recovery/expert-v20/H7qN4mR8xK2sP9cT6wF1yD5bG0uZa3eV8nL2jM6";
const EXPIRES_AT=Date.parse("2026-08-22T17:00:00.000Z");
const DEPLOY_MARKER="autonomic-expert-recovery-v20";
const PRIMARY_MODEL="@cf/nvidia/nemotron-3-120b-a12b";
const clean=v=>String(v??"").trim();
const safe=v=>clean(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:,=@/-]/g,"_").slice(0,180);
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

async function expertContext(env){
  if(!env.EXPERT_CENTER?.fetch)return{ok:false,error:"EXPERT_SERVICE_BINDING_UNAVAILABLE"};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
  try{
    const r=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/admin/context",{headers:{accept:"application/json"},signal:controller.signal}));
    const b=await r.json().catch(()=>null);
    return{ok:r.ok&&b?.ok===true,http_status:r.status,active_task:b?.active_task||null,error:r.ok?null:String(b?.error||`HTTP_${r.status}`)};
  }catch(error){return{ok:false,error:error?.name==="AbortError"?"EXPERT_CONTEXT_TIMEOUT":"EXPERT_CONTEXT_FAILED"}}
  finally{clearTimeout(timer)}
}

function planReceipt(plan){
  const s=plan?.summary||{};
  return{
    routing_fingerprint:plan?.routing_fingerprint||null,
    plan_digest:plan?.plan_digest||null,
    candidate_count:Number(s.candidate_count||0),
    company_count:Number(s.company_count||0),
    effective_model_timeout_ms:Number(s.effective_model_timeout_ms||0),
    fallback_budget_policy:s.fallback_budget_policy||null,
    runtime_lane_reselection:s.runtime_lane_reselection===true,
    runtime_reselection_applied:s.runtime_reselection_applied===true,
    runtime_quarantine_count:Number(s.runtime_quarantine_count||0),
    runtime_fallback_step_count:Number(s.runtime_fallback_step_count||0),
    runtime_fallback_success_count:Number(s.runtime_fallback_success_count||0),
    telemetry_payload_read:s.telemetry_payload_read===true,
    lanes:s.lanes||[]
  };
}

async function runRecovery(env){
  const context=await expertContext(env);
  if(!context.ok)return{ok:false,stage:"expert-context",error:context.error||"EXPERT_CONTEXT_UNAVAILABLE",context};
  if(context.active_task)return{ok:false,busy:true,stage:"expert-context",error:"EXPERT_BUSY",context};

  let plan;
  try{plan=await buildExpertRoutePlan(env,fetch)}
  catch(error){
    const advisory=await runNemotronAdvisory(env,{center:"expert",stage:"route-plan",status:"degraded",error_code:safe(error?.message||error),failure_streak:1},"expert-recovery-v20").catch(()=>null);
    return{ok:false,stage:"route-plan",error:safe(error?.message||error),advisory:advisory?{ok:advisory.ok===true,provider:advisory.provider,model:advisory.model,paid_spend_usd:Number(advisory.paid_spend_usd||0),production_mutation:advisory.production_mutation===true}:null};
  }

  const advisory=await runNemotronAdvisory(env,{center:"expert",stage:"production-e2e-recovery",status:"degraded",error_code:"EXPERT_PRODUCTION_E2E_NOT_GREEN",failure_streak:1},"expert-recovery-v20");
  if(advisory?.ok!==true)return{ok:false,stage:"nemotron-advisory",error:"NEMOTRON_ADVISORY_FAILED",advisory};

  try{
    const refreshed=await refreshExpertRoutes(env,fetch,plan);
    return{
      ok:true,
      stage:"recovered",
      selftest:"autonomic-expert-recovery-v20",
      deploy_marker:DEPLOY_MARKER,
      primary_model:PRIMARY_MODEL,
      advisory:{ok:true,provider:advisory.provider,model:advisory.model,review_model:advisory.review_model,tools_used:advisory.tools_used===true,web_used:advisory.web_used===true,paid_spend_usd:Number(advisory.paid_spend_usd||0),production_mutation:advisory.production_mutation===true,requires_deterministic_validation:advisory.requires_deterministic_validation===true},
      route:{...planReceipt(plan),route_family:refreshed?.route_family||[]},
      deterministic_route_refresh:true,
      expert_context_ok:true,
      production_worker_mutated:false,
      production_worker_traffic_changed:false,
      secrets_redacted:true
    };
  }catch(error){
    return{ok:false,stage:"route-refresh",error:safe(error?.message||error),details:error?.details||null,advisory:{ok:true,provider:advisory.provider,model:advisory.model,paid_spend_usd:Number(advisory.paid_spend_usd||0),production_mutation:advisory.production_mutation===true},...planReceipt(plan),secrets_redacted:true};
  }
}

export async function handleAutonomicExpertRecovery(req,env){
  const u=new URL(req.url);
  if(u.pathname!==ENDPOINT)return null;
  if(!["GET","POST"].includes(req.method)||Date.now()>EXPIRES_AT)return json({ok:false,error:"NOT_FOUND"},404);
  const operation=req.method==="GET"?(u.searchParams.get("operation")||"status"):"run";
  if(operation==="status")return json({ok:true,selftest:"autonomic-expert-recovery-v20",deploy_marker:DEPLOY_MARKER,primary_model:PRIMARY_MODEL,expires_at:new Date(EXPIRES_AT).toISOString(),expert:await expertContext(env),free_first:true,paid_budget_usd:0,secrets_redacted:true});
  if(operation!=="run")return json({ok:false,error:"INVALID_OPERATION",deploy_marker:DEPLOY_MARKER},400);
  const result=await runRecovery(env);
  return json({...result,deploy_marker:DEPLOY_MARKER,primary_model:PRIMARY_MODEL,free_first:true,paid_budget_usd:0,secrets_redacted:true},result.ok?200:(result.busy?409:502));
}

export const AUTONOMIC_EXPERT_RECOVERY_ENDPOINT=ENDPOINT;
