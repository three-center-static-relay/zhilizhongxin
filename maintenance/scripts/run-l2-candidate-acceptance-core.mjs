#!/usr/bin/env node
import {spawn} from "node:child_process";
import {chmodSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const ACCOUNT_ID="e3aec027af13c557bbcb831d29c1e7b4";
const COMMIT_PATTERN=/^[a-f0-9]{40}$/i;
const TAG_PATTERN=/^[a-f0-9]{12}$/i;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REMOTE_READY_TIMEOUT_MS=90000;
const REMOTE_RUN_TIMEOUT_MS=8*60*1000;
const EXECUTION_DEADLINE_MS=12*60*1000;
let currentPhase="boot";
let executionDeadlineAt=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function markPhase(phase,details={}){
  currentPhase=phase;
  console.log(JSON.stringify({event:"L2_PHASE",phase,at:new Date().toISOString(),...details,secrets_redacted:true}));
}
function beginDeadline(){executionDeadlineAt=Date.now()+EXECUTION_DEADLINE_MS}
function boundedTimeout(cap){
  const remaining=executionDeadlineAt-Date.now();
  if(remaining<=5000)throw new Error("L2_EXECUTION_DEADLINE_EXCEEDED");
  return Math.max(1000,Math.min(cap,remaining-5000));
}
function assertDeadline(){boundedTimeout(60000)}
function cleanName(value){return String(value||"").toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"")}
export function candidateWorkerName(kind,tag,stamp="test"){
  if(!["admin","maintenance","harness"].includes(kind))throw new Error("L2_CANDIDATE_KIND_INVALID");
  if(!TAG_PATTERN.test(tag))throw new Error("L2_CANDIDATE_TAG_INVALID");
  const suffix=cleanName(stamp).slice(0,16)||"run";
  return `${kind}-l2-${tag}-${suffix}`.slice(0,63).replace(/-$/g,"");
}
function secretValue(){
  const value=String(process.env.CLOUDFLARE_AI_GATEWAY_API_TOKEN||"").trim();
  if(!value)throw new Error("L2_REQUIRED_SECRET_UNAVAILABLE:CLOUDFLARE_AI_GATEWAY_API_TOKEN");
  return value;
}
function redact(text,secrets=[]){
  let out=String(text||"");
  for(const secret of secrets)if(secret)out=out.split(secret).join("[REDACTED]");
  return out;
}
function writeJson(path,value){writeFileSync(path,`${JSON.stringify(value,null,2)}\n`)}
function prepareMaintenanceCandidate(name,commit,token){
  const dir=resolve(".l2-maintenance-candidate");
  rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"worker.mjs"),`import candidate,{MaintenanceControl,MaintenanceState} from "../src/entry.js";\nexport {MaintenanceControl,MaintenanceState};\nconst PRIVATE=new Set(["/v1/control/expert-route/refresh","/v1/control/expert-route/latest"]);\nasync function augment(response,env){const text=await response.text();let body=null;try{body=text?JSON.parse(text):null}catch{};if(!body||typeof body!=="object")return new Response(text,{status:response.status,headers:response.headers});const headers=new Headers(response.headers);headers.set("content-type","application/json;charset=utf-8");headers.set("cache-control","no-store");return new Response(JSON.stringify({...body,maintenance_candidate_commit:String(env.L2_MAINTENANCE_CANDIDATE_COMMIT||"")}),{status:response.status,headers})}\nexport default{...candidate,async fetch(request,env,ctx){const response=await candidate.fetch(request,env,ctx);return PRIVATE.has(new URL(request.url).pathname)?await augment(response,env):response}};\n`);
  const configPath=resolve(dir,"wrangler.jsonc");
  writeJson(configPath,{
    name,account_id:ACCOUNT_ID,main:"worker.mjs",compatibility_date:"2026-08-18",compatibility_flags:["nodejs_compat"],workers_dev:false,preview_urls:false,
    vars:{CLOUDFLARE_ACCOUNT_ID:ACCOUNT_ID,AI_GATEWAY_ID:"test",AI_GATEWAY_ROUTE:"expert-panel-v1",EXPERT_ROUTE_REFRESH_HOURS:"6",IMMEDIATE_REFRESH_ENABLED:"false",L2_MAINTENANCE_CANDIDATE_COMMIT:commit},
    secrets:{required:["CLOUDFLARE_AI_GATEWAY_API_TOKEN"]},version_metadata:{binding:"CF_VERSION_METADATA"},
    durable_objects:{bindings:[{name:"MAINTENANCE_STATE",class_name:"MaintenanceState"}]},exports:{MaintenanceState:{type:"durable-object",storage:"sqlite"}},
    services:[{binding:"GOVERNANCE_CENTER",service:"governance-worker"},{binding:"INTELLIGENCE_CENTER",service:"intelligence-worker"},{binding:"COMPUTE_CENTER",service:"compute-worker"},{binding:"EXPERT_CENTER",service:"expert-worker"}]
  });
  const secretPath=resolve(dir,".dev.vars");
  writeFileSync(secretPath,`CLOUDFLARE_AI_GATEWAY_API_TOKEN=${JSON.stringify(token)}\n`,{mode:0o600});chmodSync(secretPath,0o600);
  return{dir,configPath,name,commit};
}
function prepareAdminCandidate(name,maintenanceName,commit){
  const dir=resolve(".l2-admin-candidate");
  rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"worker.mjs"),`export {AdminAcceptanceControl} from "../../admin/src/production-superguard.js";\nexport default{fetch(){return Response.json({ok:false,error:"CANDIDATE_HTTP_DISABLED"},{status:404})}};\n`);
  const configPath=resolve(dir,"wrangler.jsonc");
  writeJson(configPath,{
    name,account_id:ACCOUNT_ID,main:"worker.mjs",compatibility_date:"2026-08-18",compatibility_flags:["nodejs_compat"],workers_dev:false,preview_urls:false,
    services:[{binding:"MAINTENANCE_CONTROL",service:maintenanceName,props:{caller:"admin-worker",capability:"expert-route-refresh"}}],
    version_metadata:{binding:"CF_VERSION_METADATA"},vars:{L2_ADMIN_CANDIDATE_COMMIT:commit}
  });
  return{dir,configPath,name,commit};
}
function prepareHarness(name,adminName,commit){
  const dir=resolve(".l2-runtime");
  rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"worker.mjs"),`export default{async fetch(request,env){const url=new URL(request.url);if(url.pathname==="/health")return Response.json({ok:true,commit:env.L2_HARNESS_COMMIT});if(request.method==="POST"&&url.pathname==="/run"){const body=await request.text();return env.ADMIN_ACCEPTANCE.fetch(new Request("https://admin.accept/v1/control/expert-route/refresh",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body}))}return Response.json({ok:false,error:"NOT_FOUND"},{status:404})}};\n`);
  const configPath=resolve(dir,"wrangler.jsonc");
  writeJson(configPath,{name,account_id:ACCOUNT_ID,main:"worker.mjs",compatibility_date:"2026-08-18",workers_dev:false,preview_urls:false,vars:{L2_HARNESS_COMMIT:commit},services:[{binding:"ADMIN_ACCEPTANCE",service:adminName,entrypoint:"AdminAcceptanceControl",props:{caller:"expert-l2-acceptance",capability:"expert-route-acceptance"}}]});
  return{dir,configPath,name,commit};
}
function cleanup(...candidates){for(const candidate of candidates)if(candidate?.dir)rmSync(candidate.dir,{recursive:true,force:true})}

export function validateReceipt(body,commit){
  if(!COMMIT_PATTERN.test(commit))throw new Error("L2_COMMIT_INVALID");
  if(body?.ok!==true)throw new Error(`L2_RESPONSE_NOT_OK:${body?.error||"unknown"}`);
  if(body?.maintenance_candidate_commit!==commit)throw new Error("MAINTENANCE_CANDIDATE_COMMIT_MISMATCH");
  if(body?.maintenance_transport!=="fetch")throw new Error("MAINTENANCE_TRANSPORT_NOT_FETCH");
  const result=body?.result;
  if(result?.ok!==true||result?.status!=="active")throw new Error(`ROUTE_RESULT_NOT_ACTIVE:${result?.status||"missing"}`);
  if(!Array.isArray(result.route_family)||result.route_family.length!==8)throw new Error("ROUTE_FAMILY_NOT_EIGHT");
  if(result.route_family.some(route=>!route?.route_id||!route?.version_id))throw new Error("ROUTE_FAMILY_RECEIPT_INCOMPLETE");
  if(!Array.isArray(result.company_lanes)||result.company_lanes.length!==8)throw new Error("COMPANY_LANES_NOT_EIGHT");
  const companies=new Set(result.company_lanes.map(x=>String(x?.company||"").toLowerCase()).filter(Boolean));
  if(companies.size!==8)throw new Error("COMPANY_DIVERSITY_NOT_EIGHT");
  if(result.selftest?.ok!==true||result.selftest?.http_status!==200||result.selftest?.company_diverse!==true||!Array.isArray(result.selftest?.models)||result.selftest.models.length===0)throw new Error("EXPERT_SELFTEST_NOT_DIVERSE");
  if(body?.rollback_rehearsal?.ok!==true||(body.rollback_rehearsal?.mismatches||[]).length!==0)throw new Error("ROLLBACK_REHEARSAL_NOT_COMPLETE");
  const adminRuntimeVersion=UUID_PATTERN.test(String(body?.admin_version||""))?String(body.admin_version):null;
  const maintenanceRuntimeVersion=UUID_PATTERN.test(String(body?.maintenance_version||""))?String(body.maintenance_version):null;
  return{ok:true,execution_mode:"remote-dev-multiconfig-no-version-upload",admin_source_commit:commit,maintenance_source_commit:commit,admin_runtime_version:adminRuntimeVersion,maintenance_runtime_version:maintenanceRuntimeVersion,admin_transport:"remote-dev-service-binding",maintenance_transport:"fetch",route_versions:result.route_family.map(r=>({route_name:r.route_name,route_id:r.route_id,version_id:r.version_id,previous_version_id:r.previous_version_id||null})),companies:[...companies],free_lane_count:Number(result.free_lane_count||0),selftest:{ok:true,http_status:200,company_diverse:true,models:result.selftest.models},plan_digest:result.plan_digest||null,rollback_rehearsal:{ok:true},production_worker_mutation:false,secrets_redacted:true};
}

async function runRemoteHarness(harness,adminCandidate,maintenanceCandidate,requestId,token){
  markPhase("remote-dev-start",{execution_mode:"remote-dev-multiconfig-no-version-upload",admin_service:adminCandidate.name,maintenance_service:maintenanceCandidate.name,production_worker_mutation:false});
  const child=spawn("npx",["--yes",`wrangler@${WRANGLER}`,"dev","--remote","--config",harness.configPath,"--config",adminCandidate.configPath,"--config",maintenanceCandidate.configPath,"--port","8787"],{stdio:["ignore","pipe","pipe"],env:{...process.env,CI:"1"}});
  let logs="";child.stdout.on("data",d=>logs+=d);child.stderr.on("data",d=>logs+=d);
  try{
    const end=Date.now()+boundedTimeout(REMOTE_READY_TIMEOUT_MS);let ready=false;
    while(Date.now()<end){
      assertDeadline();
      if(child.exitCode!==null)throw new Error(`REMOTE_DEV_EXITED:${child.exitCode}:${redact(logs.slice(-4000),[token])}`);
      try{const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);try{const response=await fetch("http://127.0.0.1:8787/health",{signal:c.signal});if(response.ok){const body=await response.json().catch(()=>null);if(body?.ok===true&&body?.commit===harness.commit){ready=true;break}}}finally{clearTimeout(t)}}catch{}
      await sleep(1500);
    }
    if(!ready)throw new Error(`REMOTE_DEV_NOT_READY:${redact(logs.slice(-4000),[token])}`);
    markPhase("remote-dev-ready",{admin_service:adminCandidate.name,maintenance_service:maintenanceCandidate.name});
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),boundedTimeout(REMOTE_RUN_TIMEOUT_MS));
    let response;
    try{
      markPhase("remote-run-begin",{request_id:requestId});
      response=await fetch("http://127.0.0.1:8787/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({request_id:requestId}),signal:controller.signal});
    }catch(error){if(error?.name==="AbortError")throw new Error("REMOTE_RUN_TIMEOUT");throw error}
    finally{clearTimeout(timer)}
    markPhase("remote-run-response",{http_status:response.status});
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw Object.assign(new Error(`L2_HTTP_${response.status}`),{body});
    return validateReceipt(body,harness.commit);
  }finally{
    child.kill("SIGTERM");await Promise.race([new Promise(r=>child.once("exit",r)),sleep(5000)]);if(child.exitCode===null)child.kill("SIGKILL");
  }
}

async function main(){
  beginDeadline();markPhase("trigger-read");
  const request=JSON.parse(readFileSync("l2-acceptance-request.json","utf8"));
  if(request?.schema!=="expert-l2-acceptance-v1"||request?.enabled!==true)throw new Error("L2_TRIGGER_INVALID");
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();if(!COMMIT_PATTERN.test(commit))throw new Error("L2_COMMIT_SHA_INVALID");
  const tag=commit.slice(0,12),requestId=String(request.request_id||`l2-${tag}`);if(!TAG_PATTERN.test(tag)||!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))throw new Error("L2_REQUEST_INVALID");
  const token=secretValue();
  const stamp=Date.now().toString(36),maintenanceCandidate=prepareMaintenanceCandidate(candidateWorkerName("maintenance",tag,stamp),commit,token),adminCandidate=prepareAdminCandidate(candidateWorkerName("admin",tag,stamp),maintenanceCandidate.name,commit),harness=prepareHarness(candidateWorkerName("harness",tag,stamp),adminCandidate.name,commit);
  try{
    markPhase("candidates-prepared",{admin_source_commit:commit,maintenance_source_commit:commit,production_worker_mutation:false});
    const receipt=await runRemoteHarness(harness,adminCandidate,maintenanceCandidate,requestId,token);
    markPhase("dynamic-route-rollback-verified",{ok:receipt.rollback_rehearsal?.ok===true});
    console.log(JSON.stringify({event:"L2_EXPERT_ROUTE_ACCEPTANCE_PASS",request_id:requestId,...receipt}));
  }finally{cleanup(harness,adminCandidate,maintenanceCandidate);markPhase("temporary-candidates-cleaned",{production_worker_mutation:false})}
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main().catch(error=>{console.error(JSON.stringify({event:"L2_EXPERT_ROUTE_ACCEPTANCE_FAIL",phase:currentPhase,error:String(error?.message||error),details:error?.body||null,secrets_redacted:true}));process.exitCode=1});
