#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const MAINTENANCE_ENDPOINT="/__runtime-canary/force-route-refresh-v18/U9mQ5xR7vK3sP8cN6hW2yF4dB0uGzA1eC7nL5jM9";
const MAINTENANCE_MARKER="post287-route-refresh-fallback-audit-v18";
const ADMIN_ENDPOINT="/__runtime-canary/adaptive-rerun-v17/N7mQ3xR9vK2sP8cT5hW1yF6dB0uGzA4eC7nL9jM3";
const ADMIN_MARKER="post284-v17-persistent-e2e-force";
const POST273_SINCE="2026-08-22T03:50:00.000Z";
const MAX_BODY_BYTES=3*1024*1024;
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));

function fail(code,details={}){const error=new Error(code);error.details=details;throw error}
function assert(condition,code,details={}){if(!condition)fail(code,details)}
function emit(payload,stream=process.stdout){stream.write(`${JSON.stringify(payload)}\n`)}
function safe(value){return String(value??"").replace(/[^0-9A-Za-z_.:/@-]/g,"_").slice(0,180)}

function adminBase(){
  const spec=JSON.parse(readFileSync(resolve(process.cwd(),"openapi.json"),"utf8")),raw=String(spec?.servers?.[0]?.url||"").trim(),url=new URL(raw);
  assert(url.protocol==="https:"&&url.hostname.endsWith(".workers.dev"),"ADMIN_WORKERS_DEV_URL_REQUIRED");
  return `${url.protocol}//${url.host}`;
}
function maintenanceBase(admin){const url=new URL(admin);assert(url.hostname.startsWith("admin-worker."),"ADMIN_HOST_SHAPE_UNEXPECTED");url.hostname=url.hostname.replace(/^admin-worker\./,"maintenance-worker.");return `${url.protocol}//${url.host}`}

async function fetchJson(url,{timeoutMs=20000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{method:"GET",headers:{accept:"application/json","cache-control":"no-store"},signal:controller.signal}),declared=Number(response.headers.get("content-length")||0);
    if(declared>MAX_BODY_BYTES)fail("E2E_RESPONSE_TOO_LARGE",{declared});
    const text=await response.text();if(Buffer.byteLength(text)>MAX_BODY_BYTES)fail("E2E_RESPONSE_TOO_LARGE",{actual:Buffer.byteLength(text)});
    let body=null;try{body=text?JSON.parse(text):null}catch{fail("E2E_BAD_JSON",{status:response.status})}
    return{status:response.status,ok:response.ok,body};
  }finally{clearTimeout(timer)}
}

async function waitFor(label,deadlineMs,fn,intervalMs=7000){
  let last=null;
  while(Date.now()<deadlineMs){try{const value=await fn();last=value;if(value?.done)return value.value}catch(error){last={error:safe(error?.message||error)}}await sleep(intervalMs)}
  fail(`${label}_TIMEOUT`,{last});
}

function validateRouteRefresh(body,beforeFingerprint){
  assert(body?.ok===true,"ROUTE_REFRESH_OK_REQUIRED");
  assert(body?.deploy_marker===MAINTENANCE_MARKER,"ROUTE_REFRESH_MARKER_MISMATCH",{marker:body?.deploy_marker});
  assert(body?.selftest==="force-route-refresh-v18-post287","ROUTE_REFRESH_SELFTEST_MISMATCH",{selftest:body?.selftest});
  assert(/^[a-f0-9]{64}$/i.test(String(body?.routing_fingerprint||"")),"ROUTING_FINGERPRINT_REQUIRED");
  assert(/^[a-f0-9]{64}$/i.test(String(body?.plan_digest||"")),"ROUTE_PLAN_DIGEST_REQUIRED");
  assert(Number(body?.candidate_count)>=2&&Number(body?.company_count)>=2,"ROUTE_EXECUTABLE_DIVERSITY_REQUIRED",{candidate_count:body?.candidate_count,company_count:body?.company_count});
  assert(Number(body?.effective_model_timeout_ms)===30000,"POST273_TIMEOUT_NOT_ACTIVE",{effective_model_timeout_ms:body?.effective_model_timeout_ms});
  assert(body?.fallback_budget_policy==="quality<=60s-balanced<=90s-free-first<=120s-before-overhead","FALLBACK_BUDGET_POLICY_MISMATCH",{fallback_budget_policy:body?.fallback_budget_policy});
  assert(body?.runtime_lane_reselection===true,"RUNTIME_LANE_RESELECTION_REQUIRED");
  assert(Array.isArray(body?.lanes)&&body.lanes.length>=2,"ROUTE_LANES_REQUIRED",{lane_count:body?.lanes?.length});
  assert(Array.isArray(body?.route_family)&&body.route_family.length>=1,"ROUTE_FAMILY_REQUIRED");
  return{before_fingerprint:beforeFingerprint||null,after_fingerprint:body.routing_fingerprint,fingerprint_changed:Boolean(beforeFingerprint&&beforeFingerprint!==body.routing_fingerprint),plan_digest:body.plan_digest,candidate_count:Number(body.candidate_count),company_count:Number(body.company_count),effective_model_timeout_ms:Number(body.effective_model_timeout_ms),runtime_quarantine_count:Number(body.runtime_quarantine_count||0),runtime_reselection_applied:body.runtime_reselection_applied===true};
}

function participantRows(expert){return[...(Array.isArray(expert?.experts)?expert.experts:[]),...(Array.isArray(expert?.judges)?expert.judges:[])]}
function validateExpertResult(task){
  assert(task?.status==="completed","CANARY_TASK_COMPLETION_REQUIRED",{status:task?.status});
  const result=task?.result;assert(result?.ok===true,"REAL_EXPERT_E2E_OK_REQUIRED",{stage:result?.stage,http_status:result?.http_status,error:result?.error});
  assert(result?.deploy_marker===ADMIN_MARKER,"ADMIN_CANARY_MARKER_MISMATCH",{marker:result?.deploy_marker});
  assert(result?.langgraph?.ok===true&&result?.langgraph?.brain_can_command===true,"LANGGRAPH_COMMAND_REQUIRED",{langgraph:result?.langgraph});
  const planned=new Set(Array.isArray(result?.langgraph?.planned_centers)?result.langgraph.planned_centers:[]);assert(planned.has("governance")&&planned.has("expert"),"LANGGRAPH_PLAN_CENTERS_REQUIRED",{planned:[...planned]});
  assert(result?.expert_http_status===200,"EXPERT_HTTP_200_REQUIRED",{status:result?.expert_http_status});
  const expert=result?.expert;assert(expert?.ok===true&&expert?.status==="completed","EXPERT_COMPLETED_REQUIRED",{status:expert?.status,error:expert?.error});
  assert(expert?.task_profile?.task_domain==="business","SEMANTIC_DOMAIN_BUSINESS_REQUIRED",{task_profile:expert?.task_profile});
  assert(expert?.task_profile?.task_type==="comparison","SEMANTIC_TYPE_COMPARISON_REQUIRED",{task_profile:expert?.task_profile});
  assert(expert?.cost_mode==="quality-first","QUALITY_FIRST_REQUIRED",{cost_mode:expert?.cost_mode});
  assert(Number(expert?.expert_count)>=2,"DYNAMIC_EXPERT_PANEL_REQUIRED",{expert_count:expert?.expert_count});
  assert(Number(expert?.judge_count)>=1,"JUDGE_REQUIRED",{judge_count:expert?.judge_count});
  assert(Array.isArray(expert?.panel_plan?.experts)&&expert.panel_plan.experts.length>=2,"PANEL_ORGANIZATION_REQUIRED",{panel_plan:expert?.panel_plan});
  assert(expert?.company_diverse===true,"COMPANY_DIVERSITY_REQUIRED");
  const rows=participantRows(expert);assert(rows.length>=3,"PARTICIPANT_RECEIPTS_REQUIRED",{participants:rows.length});
  assert(rows.every(row=>String(row?.model||"").trim()&&String(row?.provider||"").trim()&&String(row?.company||"").trim()&&Number(row?.meta?.lane)>=1),"DYNAMIC_ROUTE_METADATA_REQUIRED");
  assert(new Set(rows.map(row=>String(row.company))).size>=2,"DYNAMIC_COMPANY_SELECTION_REQUIRED");
  assert(String(expert?.judge?.content||"").trim().length>0,"FINAL_JUDGE_CONTENT_REQUIRED");
  assert(String(expert?.final_answer||"").trim().length>0,"FINAL_SYNTHESIS_REQUIRED");
  assert(/^[a-f0-9]{64}$/i.test(String(expert?.output_digest||"")),"OUTPUT_DIGEST_REQUIRED");
  assert(result?.tools_used===false&&result?.web_used===false&&result?.production_mutation===false,"ISOLATION_POLICY_REQUIRED");
  return{attempt:task.attempt||result.attempt||null,started_at:task.started_at||null,finished_at:task.finished_at||null,elapsed_ms:Number(result.elapsed_ms||0),task_profile:expert.task_profile,expert_count:Number(expert.expert_count),judge_count:Number(expert.judge_count),panel_planner_source:expert?.panel_plan?.planner_source||null,models:[...new Set(rows.map(row=>String(row.model)))],providers:[...new Set(rows.map(row=>String(row.provider)))],companies:[...new Set(rows.map(row=>String(row.company)))],judge_present:true,final_answer_present:true,output_digest:expert.output_digest};
}

function validateFallbackAudit(body,required){
  assert(body?.ok===true,"FALLBACK_AUDIT_OK_REQUIRED",{error:body?.error});
  assert(body?.deploy_marker===MAINTENANCE_MARKER,"FALLBACK_AUDIT_MARKER_MISMATCH",{marker:body?.deploy_marker});
  assert(body?.selftest==="ai-gateway-fallback-log-audit-v1","FALLBACK_AUDIT_SELFTEST_MISMATCH");
  assert(body?.payloads_read===false&&body?.secrets_redacted===true,"FALLBACK_AUDIT_PRIVACY_REQUIRED");
  if(required)assert(Number(body?.fallback_count)>0&&body?.fallback_observed===true,"POST273_REAL_FALLBACK_NOT_OBSERVED",{expert_log_count:body?.expert_log_count,fallback_count:body?.fallback_count});
  return{since:body?.since||null,expert_log_count:Number(body?.expert_log_count||0),fallback_count:Number(body?.fallback_count||0),fallback_observed:body?.fallback_observed===true,events:Array.isArray(body?.events)?body.events.slice(0,6):[]};
}

async function main(){
  const admin=adminBase(),maintenance=maintenanceBase(admin),maintenanceCanary=`${maintenance}${MAINTENANCE_ENDPOINT}`,adminCanary=`${admin}${ADMIN_ENDPOINT}`;
  emit({ok:true,code:"POST273_E2E_GATE_START",admin_host:new URL(admin).host,maintenance_host:new URL(maintenance).host,secretless_canary_transport:true});

  await waitFor("MAINTENANCE_V18_READY",Date.now()+3*60*1000,async()=>{const r=await fetchJson(`${maintenanceCanary}?operation=audit&since=${encodeURIComponent(POST273_SINCE)}`);return{done:r.status===200&&r.body?.deploy_marker===MAINTENANCE_MARKER,value:r.body}});
  const latest=await fetchJson(`${maintenance}/v1/maintenance/expert-route/latest`),beforeFingerprint=latest?.body?.latest?.routing_fingerprint||null;
  const refresh=await waitFor("ROUTE_REFRESH",Date.now()+3*60*1000,async()=>{const r=await fetchJson(`${maintenanceCanary}?operation=run`,{timeoutMs:90000});if(r.status===409)return{done:false,value:r.body};return{done:r.status===200&&r.body?.ok===true,value:r.body}},6000),routeSummary=validateRouteRefresh(refresh,beforeFingerprint);

  await waitFor("ADMIN_V17_READY",Date.now()+3*60*1000,async()=>{const r=await fetchJson(`${adminCanary}?operation=status`);return{done:r.status===200&&r.body?.deploy_marker===ADMIN_MARKER,value:r.body}});
  let attempt=null;
  const triggered=await waitFor("EXPERT_TRIGGER",Date.now()+3*60*1000,async()=>{
    const r=await fetchJson(`${adminCanary}?operation=run`,{timeoutMs:30000});
    if(r.status===202&&r.body?.attempt){attempt=r.body.attempt;return{done:true,value:r.body}}
    if(r.status===202){const s=await fetchJson(`${adminCanary}?operation=status`);const task=s.body?.canary_task;if(task?.status==="running"&&task?.attempt){attempt=task.attempt;return{done:true,value:{...r.body,attempt}}}return{done:false,value:r.body}}
    return{done:false,value:r.body};
  },7000);
  assert(attempt,"CANARY_ATTEMPT_REQUIRED",{triggered});

  const task=await waitFor("REAL_EXPERT_E2E",Date.now()+9*60*1000,async()=>{const r=await fetchJson(`${adminCanary}?operation=status`,{timeoutMs:30000});const current=r.body?.canary_task;if(r.status===200&&current?.attempt===attempt&&current?.status==="completed")return{done:true,value:current};return{done:false,value:{status:current?.status||null,attempt:current?.attempt||null,expert_active:Boolean(r.body?.expert?.active_task)}}},8000),expertSummary=validateExpertResult(task);

  const post273=await fetchJson(`${maintenanceCanary}?operation=audit&since=${encodeURIComponent(POST273_SINCE)}`),post273Fallback=validateFallbackAudit(post273.body,true);
  const runSince=expertSummary.started_at||new Date(Date.now()-10*60*1000).toISOString(),runAudit=await fetchJson(`${maintenanceCanary}?operation=audit&since=${encodeURIComponent(runSince)}`),runFallback=validateFallbackAudit(runAudit.body,false);

  emit({ok:true,code:"POST273_REAL_EXPERT_E2E_PASS",route:routeSummary,langgraph:{brain_can_command:true,semantic_domain:"business",semantic_type:"comparison"},expert:expertSummary,fallback:{post273:post273Fallback,run_window:runFallback,real_fallback_proven:post273Fallback.fallback_count>0,exact_run_fallback_observed:runFallback.fallback_count>0},isolation:{tools:false,web:false,production_mutation:false},secrets_redacted:true});
}

main().catch(error=>{emit({ok:false,code:safe(error?.message||error),details:error?.details||null,secrets_redacted:true},process.stderr);process.exitCode=1});
