#!/usr/bin/env node
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const ENDPOINT="/__autonomic-recovery/expert-v20/H7qN4mR8xK2sP9cT6wF1yD5bG0uZa3eV8nL2jM6";
const MARKER="autonomic-expert-recovery-v20";
const MODEL="@cf/nvidia/nemotron-3-120b-a12b";
const MAX=3*1024*1024;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const safe=v=>String(v??"").replace(/[^0-9A-Za-z_.:/@-]/g,"_").slice(0,180);
function fail(code,details={}){const e=new Error(code);e.details=details;throw e}
function ok(value,code,details={}){if(!value)fail(code,details)}
function emit(value,stream=process.stdout){stream.write(JSON.stringify(value)+"\n")}

function adminSpec(){
  const candidates=[resolve(process.cwd(),"../admin/openapi.json"),resolve(process.cwd(),"admin/openapi.json"),resolve(process.cwd(),"openapi.json")];
  for(const path of candidates){try{return JSON.parse(readFileSync(path,"utf8"))}catch{}}
  fail("ADMIN_OPENAPI_REQUIRED");
}
function maintenanceBase(){
  const spec=adminSpec(),a=new URL(String(spec?.servers?.[0]?.url||""));
  ok(a.protocol==="https:"&&a.hostname.startsWith("admin-worker."),"ADMIN_URL_REQUIRED");
  a.hostname=a.hostname.replace(/^admin-worker\./,"maintenance-worker.");
  return `${a.protocol}//${a.host}`;
}
async function get(url,timeout=180000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{headers:{accept:"application/json","cache-control":"no-store"},signal:controller.signal});
    const declared=Number(response.headers.get("content-length")||0);ok(!declared||declared<=MAX,"BODY_TOO_LARGE",{declared});
    const text=await response.text();ok(Buffer.byteLength(text)<=MAX,"BODY_TOO_LARGE");
    let body=null;try{body=text?JSON.parse(text):null}catch{fail("BAD_JSON",{status:response.status})}
    return{status:response.status,body};
  }finally{clearTimeout(timer)}
}

async function main(){
  const base=maintenanceBase(),url=base+ENDPOINT;
  emit({ok:true,code:"AUTONOMIC_EXPERT_RECOVERY_START",maintenance_host:new URL(base).host,primary_model:MODEL,secrets_redacted:true});
  let status=null;
  for(let i=0;i<40;i++){
    status=await get(`${url}?operation=status`,30000).catch(error=>({status:0,body:{error:safe(error?.message)}}));
    if(status.status===200&&status.body?.deploy_marker===MARKER)break;
    await sleep(5000);
  }
  ok(status?.status===200&&status?.body?.deploy_marker===MARKER,"AUTONOMIC_ENDPOINT_NOT_READY",{status:status?.status,error:status?.body?.error});

  let result=null;
  for(let i=0;i<8;i++){
    const r=await get(`${url}?operation=run`,180000);
    if(r.status===200&&r.body?.ok===true){result=r.body;break}
    if(r.status!==409)fail("AUTONOMIC_RECOVERY_FAILED",{status:r.status,stage:r.body?.stage,error:r.body?.error,details:r.body?.details||null});
    await sleep(10000);
  }
  ok(result,"AUTONOMIC_RECOVERY_BUSY");
  ok(result.deploy_marker===MARKER&&result.selftest==="autonomic-expert-recovery-v20","RECOVERY_MARKER");
  ok(result.primary_model===MODEL,"NEMOTRON_MODEL");
  ok(result.advisory?.ok===true&&result.advisory?.model===MODEL,"NEMOTRON_ADVISORY");
  ok(result.advisory?.tools_used===false&&result.advisory?.web_used===false&&Number(result.advisory?.paid_spend_usd||0)===0&&result.advisory?.production_mutation===false,"AUTONOMIC_POLICY");
  ok(result.deterministic_route_refresh===true,"DETERMINISTIC_ROUTE_REFRESH");
  ok(/^[a-f0-9]{64}$/i.test(String(result.route?.routing_fingerprint||""))&&/^[a-f0-9]{64}$/i.test(String(result.route?.plan_digest||"")),"ROUTE_DIGEST");
  ok(Number(result.route?.candidate_count)>=2&&Number(result.route?.company_count)>=2,"ROUTE_DIVERSITY",{candidate_count:result.route?.candidate_count,company_count:result.route?.company_count});
  ok(Number(result.route?.effective_model_timeout_ms)===30000,"TIMEOUT_30S");
  ok(result.route?.runtime_lane_reselection===true&&result.route?.telemetry_payload_read===false,"ROUTE_POLICY");
  emit({ok:true,code:"AUTONOMIC_EXPERT_RECOVERY_PASS",primary_model:MODEL,candidate_count:Number(result.route.candidate_count),company_count:Number(result.route.company_count),runtime_quarantine_count:Number(result.route.runtime_quarantine_count||0),runtime_reselection_applied:result.route.runtime_reselection_applied===true,route_family_count:Array.isArray(result.route.route_family)?result.route.route_family.length:0,paid_spend_usd:0,tools_used:false,web_used:false,secrets_redacted:true});
}

main().catch(error=>{emit({ok:false,code:safe(error?.message||error),details:error?.details||null,secrets_redacted:true},process.stderr);process.exitCode=1});
