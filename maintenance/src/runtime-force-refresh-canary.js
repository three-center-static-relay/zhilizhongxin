import app from "./index.js";
import {buildExpertRoutePlan,refreshExpertRoutes} from "./expert-route-manager.js";
export {MaintenanceState} from "./index.js";

const ENDPOINT="/__runtime-canary/force-route-refresh-v18/U9mQ5xR7vK3sP8cN6hW2yF4dB0uGzA1eC7nL5jM9";
const EXPIRES_AT=Date.parse("2026-08-22T08:15:00.000Z");
const DEPLOY_MARKER="post287-route-refresh-fallback-audit-v18";
const POST273_SINCE=Date.parse("2026-08-22T03:50:00.000Z");
const MAX_AUDIT_PAGES=6;
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

function clean(v){return String(v??"").trim()}
function safe(v){return clean(v).replace(/[^0-9A-Za-z_.:/@-]/g,"_").slice(0,180)}
function credentials(env){return{accountId:clean(env?.CF_ACCOUNT_ID||env?.CLOUDFLARE_ACCOUNT_ID),token:clean(env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN||env?.CF_API_TOKEN),gatewayId:clean(env?.AI_GATEWAY_ID||"test")}}
function parseMetadata(value){if(value&&typeof value==="object")return value;try{const parsed=JSON.parse(String(value||""));return parsed&&typeof parsed==="object"?parsed:{}}catch{return{}}}
function expertMetadata(meta){const lane=Math.trunc(Number(meta?.lane)),stage=clean(meta?.stage).toLowerCase(),costMode=clean(meta?.cost_mode).toLowerCase();return Number.isFinite(lane)&&lane>=1&&lane<=8&&Boolean(stage)&&Boolean(costMode)}

async function gatewayFallbackAudit(env,sinceMs=POST273_SINCE){
  const {accountId,token,gatewayId}=credentials(env);
  if(!accountId||!token||!gatewayId)throw new Error("AI_GATEWAY_AUDIT_NOT_CONFIGURED");
  const since=Math.max(POST273_SINCE,Number.isFinite(Number(sinceMs))?Number(sinceMs):POST273_SINCE),rows=[];
  for(let page=1;page<=MAX_AUDIT_PAGES;page++){
    const url=new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai-gateway/gateways/${encodeURIComponent(gatewayId)}/logs`);
    url.searchParams.set("per_page","50");url.searchParams.set("page",String(page));url.searchParams.set("start_date",new Date(since).toISOString());
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(url,{headers:{authorization:`Bearer ${token}`,accept:"application/json"},signal:controller.signal}),body=await response.json().catch(()=>null);
      if(!response.ok||body?.success===false)throw new Error(`AI_GATEWAY_LOGS_HTTP_${response.status}`);
      const pageRows=Array.isArray(body?.result)?body.result:[];rows.push(...pageRows);
      if(pageRows.length<50)break;
    }finally{clearTimeout(timer)}
  }
  const expertRows=rows.filter(row=>{const at=Date.parse(row?.created_at||"");return Number.isFinite(at)&&at>=since&&expertMetadata(parseMetadata(row?.metadata))});
  const fallbackRows=expertRows.filter(row=>Number(row?.step)>0);
  const events=fallbackRows.slice(0,12).map(row=>{const meta=parseMetadata(row?.metadata);return{created_at:String(row?.created_at||""),step:Number(row?.step||0),success:row?.success===true,status_code:Number(row?.status_code||0),provider:safe(row?.provider),model:safe(row?.model),stage:safe(meta?.stage),lane:safe(meta?.lane),cost_mode:safe(meta?.cost_mode)}});
  return{ok:true,selftest:"ai-gateway-fallback-log-audit-v1",deploy_marker:DEPLOY_MARKER,since:new Date(since).toISOString(),expert_log_count:expertRows.length,fallback_count:fallbackRows.length,fallback_observed:fallbackRows.length>0,max_pages:MAX_AUDIT_PAGES,events,secrets_redacted:true,payloads_read:false};
}

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
      const operation=u.searchParams.get("operation")||"run";
      if(operation==="audit"){
        try{return json(await gatewayFallbackAudit(env,Date.parse(u.searchParams.get("since")||"")||POST273_SINCE))}
        catch(error){return json({ok:false,selftest:"ai-gateway-fallback-log-audit-v1",deploy_marker:DEPLOY_MARKER,error:safe(error?.message||error),secrets_redacted:true,payloads_read:false},502)}
      }
      if(operation!=="run")return json({ok:false,error:"INVALID_OPERATION",deploy_marker:DEPLOY_MARKER},400);
      if(!await expertIdle(env))return json({ok:false,error:"EXPERT_BUSY_OR_CONTEXT_UNAVAILABLE",deploy_marker:DEPLOY_MARKER},409);
      try{
        const plan=await buildExpertRoutePlan(env,fetch);
        const receipt=await refreshExpertRoutes(env,fetch,plan);
        return json({ok:true,selftest:"force-route-refresh-v18-post287",deploy_marker:DEPLOY_MARKER,routing_fingerprint:plan.routing_fingerprint,plan_digest:plan.plan_digest,candidate_count:plan.summary?.candidate_count||0,company_count:plan.summary?.company_count||0,effective_model_timeout_ms:plan.summary?.effective_model_timeout_ms||null,fallback_budget_policy:plan.summary?.fallback_budget_policy||null,runtime_lane_reselection:plan.summary?.runtime_lane_reselection===true,runtime_reselection_applied:plan.summary?.runtime_reselection_applied===true,provider_execution_status:plan.summary?.provider_execution_status||{},runtime_quarantine_count:plan.summary?.runtime_quarantine_count||0,runtime_quarantine_reason:plan.summary?.runtime_quarantine_reason||null,lanes:plan.summary?.lanes||[],route_family:receipt.route_family||[],secrets_redacted:true});
      }catch(error){
        return json({ok:false,error:safe(error?.message||error),details:error?.details||null,deploy_marker:DEPLOY_MARKER,secrets_redacted:true},502);
      }
    }
    return app.fetch(req,env,ctx);
  },
  async scheduled(controller,env,ctx){return app.scheduled(controller,env,ctx)}
};
