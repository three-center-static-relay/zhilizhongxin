#!/usr/bin/env node
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const MEP="/__autonomic-recovery/expert-v20/H7qN4mR8xK2sP9cT6wF1yD5bG0uZa3eV8nL2jM6";
const M_MARKER="autonomic-expert-recovery-v20";
const AEP="/__autonomic-recovery/expert-e2e-v20/Q8mT3xR7vK5sP2cN9hW1yF6dB0uGzA4eC7nL5jM3";
const A_MARKER="autonomic-expert-e2e-v20";
const MAX=3*1024*1024;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const safe=v=>String(v??"").replace(/[^0-9A-Za-z_.:/@-]/g,"_").slice(0,180);
function fail(code,details={}){const e=new Error(code);e.details=details;throw e}
function ok(value,code,details={}){if(!value)fail(code,details)}
function emit(value,stream=process.stdout){stream.write(JSON.stringify(value)+"\n")}
function bases(){
  const spec=JSON.parse(readFileSync(resolve(process.cwd(),"openapi.json"),"utf8")),admin=new URL(String(spec?.servers?.[0]?.url||""));
  ok(admin.protocol==="https:"&&admin.hostname.startsWith("admin-worker."),"ADMIN_URL_REQUIRED");
  const maintenance=new URL(admin);maintenance.hostname=maintenance.hostname.replace(/^admin-worker\./,"maintenance-worker.");
  return{admin:`${admin.protocol}//${admin.host}`,maintenance:`${maintenance.protocol}//${maintenance.host}`};
}
async function get(url,timeout=240000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{headers:{accept:"application/json","cache-control":"no-store"},signal:controller.signal});
    const declared=Number(response.headers.get("content-length")||0);ok(!declared||declared<=MAX,"BODY_TOO_LARGE",{declared});
    const text=await response.text();ok(Buffer.byteLength(text)<=MAX,"BODY_TOO_LARGE");
    let body=null;try{body=text?JSON.parse(text):null}catch{fail("BAD_JSON",{status:response.status})}
    return{status:response.status,body};
  }finally{clearTimeout(timer)}
}
function dynamicRows(expert){return[...(Array.isArray(expert?.experts)?expert.experts:[]),...(Array.isArray(expert?.judges)?expert.judges:[])]}

async function main(){
  const{admin,maintenance}=bases(),mu=maintenance+MEP,au=admin+AEP;
  emit({ok:true,code:"AUTONOMIC_EXPERT_E2E_START",admin_host:new URL(admin).host,maintenance_host:new URL(maintenance).host,secrets_redacted:true});

  let ms=null;
  for(let i=0;i<40;i++){
    ms=await get(`${mu}?operation=status`,30000).catch(error=>({status:0,body:{error:safe(error?.message)}}));
    if(ms.status===200&&ms.body?.deploy_marker===M_MARKER)break;
    await sleep(5000);
  }
  ok(ms?.status===200&&ms.body?.deploy_marker===M_MARKER,"MAINTENANCE_RECOVERY_NOT_READY",{status:ms?.status,error:ms?.body?.error});

  let recovery=null;
  for(let i=0;i<8;i++){
    const r=await get(`${mu}?operation=run`,180000);
    if(r.status===200&&r.body?.ok===true){recovery=r.body;break}
    if(r.status!==409)fail("AUTONOMIC_RECOVERY_FAILED",{status:r.status,stage:r.body?.stage,error:r.body?.error,details:r.body?.details||null});
    await sleep(10000);
  }
  ok(recovery,"AUTONOMIC_RECOVERY_BUSY");
  ok(recovery.advisory?.ok===true&&recovery.deterministic_route_refresh===true,"AUTONOMIC_RECOVERY_INCOMPLETE");
  ok(Number(recovery.route?.candidate_count)>=2&&Number(recovery.route?.company_count)>=2,"ROUTE_DIVERSITY");

  let as=null;
  for(let i=0;i<40;i++){
    as=await get(`${au}?operation=status`,30000).catch(error=>({status:0,body:{error:safe(error?.message)}}));
    if(as.status===200&&as.body?.deploy_marker===A_MARKER)break;
    await sleep(5000);
  }
  ok(as?.status===200&&as.body?.deploy_marker===A_MARKER,"ADMIN_E2E_NOT_READY",{status:as?.status,error:as?.body?.error});

  let run=null;
  for(let i=0;i<8;i++){
    const r=await get(`${au}?operation=run`,7*60*1000);
    if(r.status===200&&r.body?.ok===true){run=r.body;break}
    if(r.status!==409)fail("EXPERT_E2E_FAILED",{status:r.status,stage:r.body?.stage,error:r.body?.error,expert_error:r.body?.expert?.error||r.body?.expert?.error_code||null});
    await sleep(10000);
  }
  ok(run,"EXPERT_E2E_BUSY");
  ok(run.deploy_marker===A_MARKER&&run.selftest==="autonomic-expert-e2e-v20","E2E_MARKER");
  ok(run.langgraph?.ok===true&&run.langgraph?.brain_can_command===true,"LANGGRAPH_COMMAND");
  const planned=new Set(run.langgraph?.planned_centers||[]);ok(planned.has("governance")&&planned.has("expert"),"LANGGRAPH_CENTERS");
  const expert=run.expert;
  ok(run.expert_http_status===200&&expert?.ok===true&&expert?.status==="completed","EXPERT_COMPLETE",{status:run.expert_http_status,error:expert?.error||expert?.error_code});
  ok(expert?.task_profile?.task_domain==="business"&&expert?.task_profile?.task_type==="comparison","SEMANTIC_PROFILE",{task_profile:expert?.task_profile});
  ok(Number(expert?.expert_count)>=2&&Number(expert?.judge_count)>=1,"PANEL_COUNTS",{expert_count:expert?.expert_count,judge_count:expert?.judge_count});
  const rows=dynamicRows(expert);ok(rows.length>=3&&rows.every(x=>x?.model&&x?.provider&&x?.company&&Number(x?.meta?.lane)>=1),"DYNAMIC_RECEIPTS");
  ok(new Set(rows.map(x=>String(x.company))).size>=2,"COMPANY_DIVERSITY");
  ok(String(expert?.judge?.content||"").trim()&&String(expert?.final_answer||"").trim(),"JUDGE_FINAL");
  ok(/^[a-f0-9]{64}$/i.test(String(expert?.output_digest||"")),"OUTPUT_DIGEST");
  ok(run.tools_used===false&&run.web_used===false&&run.production_mutation===false,"ISOLATION");

  emit({ok:true,code:"AUTONOMIC_EXPERT_E2E_PASS",autonomic:{primary_model:recovery.primary_model,route_candidate_count:Number(recovery.route.candidate_count),route_company_count:Number(recovery.route.company_count),runtime_quarantine_count:Number(recovery.route.runtime_quarantine_count||0),runtime_reselection_applied:recovery.route.runtime_reselection_applied===true},langgraph:{brain_can_command:true,planned_centers:[...planned]},expert:{expert_count:Number(expert.expert_count),judge_count:Number(expert.judge_count),models:[...new Set(rows.map(x=>String(x.model)))],providers:[...new Set(rows.map(x=>String(x.provider)))],companies:[...new Set(rows.map(x=>String(x.company)))],output_digest:expert.output_digest,elapsed_ms:Number(run.elapsed_ms||0)},isolation:{tools:false,web:false,production_mutation:false},secrets_redacted:true});
}

main().catch(error=>{emit({ok:false,code:safe(error?.message||error),details:error?.details||null,secrets_redacted:true},process.stderr);process.exitCode=1});
