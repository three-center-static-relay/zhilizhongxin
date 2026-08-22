import app from "./index.js";
import {buildExpertRoutePlan,refreshExpertRoutes} from "./expert-route-manager.js";
export {MaintenanceState} from "./index.js";

const CF_API="https://api.cloudflare.com/client/v4";
const ENDPOINT="/__runtime-canary/force-route-refresh-v18/V9mQ4xR7vK2sP8cT5hW1yF6dB0uGzA3eC7nL4jN8";
const EXPIRES_AT=Date.parse("2026-08-22T07:45:00.000Z");
const DEPLOY_MARKER="post284-gateway-diagnostics-v18";
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const scalar=v=>["string","number","boolean"].includes(typeof v)?String(v).slice(0,180):null;
const uniq=xs=>[...new Set(xs.filter(Boolean))];

async function expertIdle(env){
  if(!env.EXPERT_CENTER?.fetch)return false;
  const r=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/admin/context",{headers:{accept:"application/json"}}));
  const body=await r.json().catch(()=>null);
  return r.ok&&body?.ok===true&&!body?.active_task;
}

function rowProbe(row){
  const provider_candidates=uniq([row?.provider,row?.provider_name,row?.providerName,row?.provider_slug,row?.request?.provider,row?.metadata?.provider].map(scalar));
  const model_candidates=uniq([row?.model,row?.model_name,row?.modelName,row?.request?.model,row?.metadata?.model].map(scalar));
  const status_candidates=uniq([row?.status_code,row?.status,row?.response?.status,row?.response?.status_code].map(scalar));
  const code_candidates=uniq([row?.internal_code,row?.internalCode,row?.error_code,row?.error?.code,row?.response?.error?.code].map(scalar));
  const text=JSON.stringify([row?.error?.message,row?.message,row?.description,row?.response?.error?.message,row?.internal_code,row?.internalCode]).toLowerCase();
  return{created_at:scalar(row?.created_at||row?.createdAt),provider_candidates,model_candidates,status_candidates,code_candidates,chat_incompatible:text.includes("2020")||text.includes("does not support chat completion"),timeout:text.includes("timeout")||text.includes("2014")||status_candidates.includes("504"),success:row?.success===true,top_level_keys:Object.keys(row||{}).sort().slice(0,80)};
}

async function gatewayDiagnostics(env){
  const accountId=String(env?.CF_ACCOUNT_ID||env?.CLOUDFLARE_ACCOUNT_ID||"").trim(),token=String(env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN||env?.CF_API_TOKEN||"").trim(),gatewayId=String(env?.AI_GATEWAY_ID||"test").trim();
  if(!accountId||!token||!gatewayId)return{ok:false,error:"GATEWAY_DIAGNOSTIC_CONFIG_UNAVAILABLE",rows:[]};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{
    const r=await fetch(`${CF_API}/accounts/${encodeURIComponent(accountId)}/ai-gateway/gateways/${encodeURIComponent(gatewayId)}/logs?per_page=25&page=1&order_by=created_at&order_by_direction=desc`,{headers:{authorization:`Bearer ${token}`,accept:"application/json"},signal:controller.signal}),payload=await r.json().catch(()=>null),data=payload?.result??payload?.data??payload,rows=Array.isArray(data)?data:Array.isArray(data?.logs)?data.logs:Array.isArray(payload?.logs)?payload.logs:[];
    if(!r.ok||payload?.success===false)return{ok:false,http_status:r.status,error:"GATEWAY_DIAGNOSTIC_READ_FAILED",rows:[]};
    return{ok:true,row_count:rows.length,rows:rows.map(rowProbe)};
  }catch{return{ok:false,error:"GATEWAY_DIAGNOSTIC_READ_FAILED",rows:[]}}finally{clearTimeout(timer)}
}

function routeDebug(plan){return(plan?.routes||[]).map(r=>({route_name:r.routeName,lanes:r.lanes,models:(r.elements||[]).filter(e=>e?.type==="model").map(e=>({id:e.id,provider:e?.properties?.provider||null,model:e?.properties?.model||null,timeout:e?.properties?.timeout||null,retries:e?.properties?.retries||0,fallback:e?.outputs?.fallback?.elementId||null}))}))}

export default{
  async fetch(req,env,ctx){
    const u=new URL(req.url);
    if(u.pathname===ENDPOINT){
      if(!["POST","GET"].includes(req.method)||Date.now()>EXPIRES_AT)return json({ok:false,error:"NOT_FOUND"},404);
      const operation=u.searchParams.get("operation")||"refresh";
      if(operation==="diagnose"){
        try{const plan=await buildExpertRoutePlan(env,fetch),gateway=await gatewayDiagnostics(env);return json({ok:true,selftest:"gateway-redacted-diagnostics-v18",deploy_marker:DEPLOY_MARKER,routing_fingerprint:plan.routing_fingerprint,runtime_quarantine_count:plan.summary?.runtime_quarantine_count||0,runtime_reselection_applied:plan.summary?.runtime_reselection_applied===true,lanes:plan.summary?.lanes||[],route_models:routeDebug(plan),gateway,secrets_redacted:true})}catch(error){return json({ok:false,error:String(error?.message||error).slice(0,160),deploy_marker:DEPLOY_MARKER,secrets_redacted:true},502)}
      }
      if(operation!=="refresh")return json({ok:false,error:"INVALID_OPERATION",deploy_marker:DEPLOY_MARKER},400);
      if(!await expertIdle(env))return json({ok:false,error:"EXPERT_BUSY_OR_CONTEXT_UNAVAILABLE",deploy_marker:DEPLOY_MARKER},409);
      try{
        const plan=await buildExpertRoutePlan(env,fetch);
        const receipt=await refreshExpertRoutes(env,fetch,plan);
        return json({ok:true,selftest:"force-route-refresh-v18-post284",deploy_marker:DEPLOY_MARKER,routing_fingerprint:plan.routing_fingerprint,plan_digest:plan.plan_digest,candidate_count:plan.summary?.candidate_count||0,company_count:plan.summary?.company_count||0,effective_model_timeout_ms:plan.summary?.effective_model_timeout_ms||null,fallback_budget_policy:plan.summary?.fallback_budget_policy||null,runtime_lane_reselection:plan.summary?.runtime_lane_reselection===true,runtime_reselection_applied:plan.summary?.runtime_reselection_applied===true,provider_execution_status:plan.summary?.provider_execution_status||{},runtime_quarantine_count:plan.summary?.runtime_quarantine_count||0,runtime_quarantine_reason:plan.summary?.runtime_quarantine_reason||null,lanes:plan.summary?.lanes||[],route_family:receipt.route_family||[],secrets_redacted:true});
      }catch(error){
        return json({ok:false,error:String(error?.message||error).slice(0,160),details:error?.details||null,deploy_marker:DEPLOY_MARKER,secrets_redacted:true},502);
      }
    }
    return app.fetch(req,env,ctx);
  },
  async scheduled(controller,env,ctx){return app.scheduled(controller,env,ctx)}
};
