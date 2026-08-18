#!/usr/bin/env node
import {spawn,spawnSync} from "node:child_process";
import {mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const TAG_PATTERN=/^[a-f0-9]{12}$/i;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function stripAnsi(value){return String(value||"").replace(/\u001b\[[0-9;]*m/g,"")}
function cleanJson(value){
  const text=stripAnsi(value).trim();
  if(!text)throw new Error("WRANGLER_JSON_EMPTY");
  try{return JSON.parse(text)}catch{}
  const starts=[text.indexOf("["),text.indexOf("{")].filter(x=>x>=0).sort((a,b)=>a-b);
  for(const start of starts){
    for(const end of [text.lastIndexOf("]"),text.lastIndexOf("}")].filter(x=>x>start).sort((a,b)=>b-a)){
      try{return JSON.parse(text.slice(start,end+1))}catch{}
    }
  }
  throw new Error("WRANGLER_JSON_INVALID");
}
function command(cwd,args,{stdio="pipe"}={}){
  const r=spawnSync("npx",["--yes",`wrangler@${WRANGLER}`,...args],{cwd,encoding:"utf8",env:process.env,stdio,maxBuffer:8*1024*1024});
  if(r.error)throw r.error;
  if(r.status!==0){const e=new Error(`WRANGLER_FAILED:${args.join(" ")}`);e.stderr=stripAnsi(r.stderr);e.stdout=stripAnsi(r.stdout);throw e}
  return r;
}
function runJson(cwd,args){return cleanJson(command(cwd,[...args,"--json"]).stdout)}
function gitRoot(){const r=spawnSync("git",["rev-parse","--show-toplevel"],{encoding:"utf8",env:process.env});if(r.status!==0)throw new Error("GIT_ROOT_UNAVAILABLE");return r.stdout.trim()}
function candidateRows(payload){
  if(Array.isArray(payload))return payload;
  for(const key of ["versions","result","data"]){if(Array.isArray(payload?.[key]))return payload[key]}
  return[];
}
function rowTag(row){return String(row?.tag??row?.version_tag??row?.annotations?.["workers/tag"]??row?.annotations?.tag??"").trim()}
function rowId(row){return String(row?.id??row?.version_id??"").trim()}
export function findVersionByTag(payload,tag){
  const matches=candidateRows(payload).filter(row=>rowTag(row)===tag).map(rowId).filter(Boolean);
  const unique=[...new Set(matches)];
  if(unique.length!==1||!UUID_PATTERN.test(unique[0]||""))throw new Error(`CANDIDATE_VERSION_TAG_MATCH:${tag}:${unique.length}`);
  return unique[0];
}
function deploymentCandidates(payload){
  const roots=[payload,payload?.deployment,payload?.result,payload?.data].filter(Boolean);
  for(const root of roots){
    if(Array.isArray(root?.versions))return root.versions;
    if(Array.isArray(root)&&root.some(x=>x&&typeof x==="object"&&("percentage" in x)))return root;
  }
  return[];
}
export function currentDeployment(payload){
  const rows=deploymentCandidates(payload).map(row=>({id:String(row?.version_id??row?.id??"").trim(),percentage:Number(row?.percentage)})).filter(row=>row.id&&Number.isFinite(row.percentage));
  if(!rows.length)throw new Error("CURRENT_DEPLOYMENT_EMPTY");
  const unique=[];for(const row of rows){if(!unique.some(x=>x.id===row.id))unique.push(row)}
  return unique;
}
export function stageSpecs(snapshot,candidate){
  if(!UUID_PATTERN.test(candidate||""))throw new Error("CANDIDATE_VERSION_INVALID");
  const positive=snapshot.filter(x=>x.percentage>0);
  if(positive.length!==1||Math.abs(positive[0].percentage-100)>1e-9)throw new Error("CURRENT_DEPLOYMENT_NOT_100_STABLE");
  if(positive[0].id===candidate)throw new Error("CANDIDATE_ALREADY_STABLE");
  return[{id:positive[0].id,percentage:100},{id:candidate,percentage:0}];
}
function specsArgs(specs){return specs.map(x=>`${x.id}@${x.percentage}%`)}
function deploySpecs(cwd,specs,message){command(cwd,["versions","deploy",...specsArgs(specs),"-y","--message",message],{stdio:"inherit"})}
function versions(cwd){return runJson(cwd,["versions","list"])}
function deployment(cwd){return currentDeployment(runJson(cwd,["deployments","status"]))}
function sameDeployment(a,b){
  const norm=x=>x.slice().sort((m,n)=>m.id.localeCompare(n.id)).map(v=>`${v.id}@${Number(v.percentage)}`);
  return JSON.stringify(norm(a))===JSON.stringify(norm(b));
}
function ensureAdminCandidate(adminDir,tag){
  try{return findVersionByTag(versions(adminDir),tag)}catch{}
  const l2tag=`l2-${tag}`;
  try{return findVersionByTag(versions(adminDir),l2tag)}catch{}
  command(adminDir,["versions","upload","--tag",l2tag,"--message",`L2 acceptance candidate ${tag}`],{stdio:"inherit"});
  return findVersionByTag(versions(adminDir),l2tag);
}
async function exactCandidate(cwd,tag,attempts=12){
  let last;
  for(let i=0;i<attempts;i++){
    try{return findVersionByTag(versions(cwd),tag)}catch(e){last=e;await sleep(1000)}
  }
  throw last||new Error(`CANDIDATE_NOT_FOUND:${tag}`);
}
function overrideValue(adminVersion,maintenanceVersion){return `admin-worker="${adminVersion}", maintenance-worker="${maintenanceVersion}"`}
export function validateReceipt(body,adminVersion,maintenanceVersion){
  if(body?.ok!==true)throw new Error(`L2_RECEIPT_NOT_OK:${body?.error||body?.result?.error||"unknown"}`);
  if(body?.admin_version!==adminVersion)throw new Error("ADMIN_VERSION_OVERRIDE_NOT_APPLIED");
  if(body?.maintenance_version!==maintenanceVersion)throw new Error("MAINTENANCE_VERSION_OVERRIDE_NOT_APPLIED");
  if(body?.transport!=="fetch-version-override")throw new Error("ADMIN_OVERRIDE_TRANSPORT_NOT_PROVEN");
  if(body?.maintenance_transport!=="fetch")throw new Error("MAINTENANCE_FETCH_TRANSPORT_NOT_PROVEN");
  const result=body?.result;
  if(result?.ok!==true||result?.status!=="active")throw new Error(`ROUTE_FAMILY_NOT_ACTIVE:${result?.status||"missing"}`);
  if(!Array.isArray(result.route_family)||result.route_family.length!==8)throw new Error("ROUTE_FAMILY_COUNT_INVALID");
  for(const route of result.route_family){if(!route?.route_name||!route?.route_id||!route?.version_id)throw new Error("ROUTE_RECEIPT_INCOMPLETE")}
  if(!Array.isArray(result.company_lanes)||result.company_lanes.length!==8)throw new Error("COMPANY_LANE_COUNT_INVALID");
  if(new Set(result.company_lanes.map(x=>x?.company).filter(Boolean)).size!==8)throw new Error("COMPANY_DIVERSITY_INVALID");
  if(result?.selftest?.ok!==true||Number(result?.selftest?.http_status)!==200||result?.selftest?.company_diverse!==true)throw new Error("EXPERT_SELFTEST_INVALID");
  if(!Array.isArray(result?.selftest?.models)||result.selftest.models.length===0)throw new Error("EXPERT_SELFTEST_MODELS_EMPTY");
  if(body?.rollback_rehearsal?.ok!==true||!Array.isArray(body?.rollback_rehearsal?.mismatches)||body.rollback_rehearsal.mismatches.length!==0)throw new Error("ROUTE_ROLLBACK_REHEARSAL_FAILED");
  return{ok:true,route_count:8,company_count:8,admin_version:adminVersion,maintenance_version:maintenanceVersion,plan_digest:result.plan_digest||null,free_lane_count:result.free_lane_count??null,selftest_models:result.selftest.models};
}
function harnessFiles(root){
  const dir=resolve(root,".l2-remote-harness");rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  const worker=`export default{async fetch(req,env){const u=new URL(req.url);if(u.pathname==="/health")return Response.json({ok:true});const overrides=req.headers.get("x-l2-overrides")||"";const headers={accept:"application/json","Cloudflare-Workers-Version-Overrides":overrides};if(req.method==="GET"&&u.pathname==="/probe")return env.ADMIN_ACCEPTANCE.fetch(new Request("https://admin.acceptance/v1/control/version",{headers}));if(req.method==="POST"&&u.pathname==="/run"){headers["content-type"]="application/json";const body=await req.text();return env.ADMIN_ACCEPTANCE.fetch(new Request("https://admin.acceptance/v1/control/expert-route/refresh",{method:"POST",headers,body}))}return Response.json({ok:false,error:"NOT_FOUND"},{status:404})}};`;
  const config={name:"expert-l2-acceptance-dev",main:"worker.mjs",compatibility_date:"2026-08-18",services:[{binding:"ADMIN_ACCEPTANCE",service:"admin-worker",entrypoint:"AdminAcceptanceControl",props:{caller:"expert-l2-acceptance",capability:"expert-route-acceptance"}}]};
  writeFileSync(resolve(dir,"worker.mjs"),worker);writeFileSync(resolve(dir,"wrangler.jsonc"),JSON.stringify(config,null,2));return dir;
}
async function waitHttp(url,{method="GET",headers,body,attempts=45,requireOk=true}={}){
  let last;
  for(let i=0;i<attempts;i++){
    try{const r=await fetch(url,{method,headers,body});if(!requireOk||r.ok)return r;last=new Error(`HTTP_${r.status}`)}catch(e){last=e}
    await sleep(1000);
  }
  throw last||new Error("HTTP_WAIT_FAILED");
}
async function remoteHarness(root,adminVersion,maintenanceVersion,requestId){
  const dir=harnessFiles(root),port=8900+(process.pid%500),logs=[];
  const child=spawn("npx",["--yes",`wrangler@${WRANGLER}`,"dev","--remote","--config","wrangler.jsonc","--ip","127.0.0.1","--port",String(port),"--show-interactive-dev-session=false","--log-level","error"],{cwd:dir,env:{...process.env,WRANGLER_SEND_METRICS:"false"},stdio:["ignore","pipe","pipe"]});
  child.stdout?.on("data",d=>logs.push(stripAnsi(d).slice(-4000)));child.stderr?.on("data",d=>logs.push(stripAnsi(d).slice(-4000)));
  try{
    await waitHttp(`http://127.0.0.1:${port}/health`);
    const overrides=overrideValue(adminVersion,maintenanceVersion),probeHeaders={"x-l2-overrides":overrides};
    let proven=false,lastProbe=null;
    for(let attempt=1;attempt<=12;attempt++){
      const r=await waitHttp(`http://127.0.0.1:${port}/probe`,{headers:probeHeaders,attempts:2,requireOk:false});
      lastProbe=await r.json().catch(()=>null);
      if(r.ok&&lastProbe?.ok===true&&lastProbe?.admin_version===adminVersion&&lastProbe?.maintenance_version===maintenanceVersion&&lastProbe?.transport==="fetch-version-override"&&lastProbe?.maintenance_transport==="fetch"){proven=true;break}
      await sleep(1500);
    }
    if(!proven)throw Object.assign(new Error("VERSION_OVERRIDE_PROBE_FAILED"),{details:lastProbe});
    const r=await fetch(`http://127.0.0.1:${port}/run`,{method:"POST",headers:{"content-type":"application/json","x-l2-overrides":overrides},body:JSON.stringify({request_id:requestId})});
    const body=await r.json().catch(()=>null);
    if(!r.ok&&body?.ok!==true)throw Object.assign(new Error(`L2_REMOTE_HTTP_${r.status}`),{details:body});
    return body;
  }finally{
    child.kill("SIGTERM");await Promise.race([new Promise(r=>child.once("exit",r)),sleep(3000)]);rmSync(dir,{recursive:true,force:true});
  }
}

export async function main(){
  const trigger=JSON.parse(readFileSync(resolve(process.cwd(),"l2-acceptance-request.json"),"utf8"));
  if(trigger?.schema!=="expert-l2-acceptance-v1"||trigger?.enabled!==true)throw new Error("L2_TRIGGER_NOT_ENABLED");
  const requestId=String(trigger.request_id||"").trim();if(!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))throw new Error("L2_REQUEST_ID_INVALID");
  const sha=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim(),tag=sha.slice(0,12);if(!TAG_PATTERN.test(tag))throw new Error("L2_COMMIT_TAG_INVALID");
  const root=gitRoot(),maintenanceDir=resolve(root,"maintenance"),adminDir=resolve(root,"admin");
  const maintenanceVersion=await exactCandidate(maintenanceDir,tag),adminVersion=ensureAdminCandidate(adminDir,tag);
  const beforeAdmin=deployment(adminDir),beforeMaintenance=deployment(maintenanceDir);
  let primaryError=null,result=null;const restoreErrors=[];
  try{
    deploySpecs(adminDir,stageSpecs(beforeAdmin,adminVersion),`L2 0% candidate ${tag}`);
    deploySpecs(maintenanceDir,stageSpecs(beforeMaintenance,maintenanceVersion),`L2 0% candidate ${tag}`);
    await sleep(2500);
    const body=await remoteHarness(root,adminVersion,maintenanceVersion,requestId);
    result=validateReceipt(body,adminVersion,maintenanceVersion);
    console.log(JSON.stringify({event:"L2_EXPERT_ROUTE_ACCEPTANCE_PASS",...result,secrets_redacted:true}));
  }catch(error){primaryError=error;console.error(JSON.stringify({event:"L2_EXPERT_ROUTE_ACCEPTANCE_FAIL",error:String(error?.message||error),details:error?.details||null,secrets_redacted:true}))}
  finally{
    for(const [name,dir,snapshot] of [["maintenance",maintenanceDir,beforeMaintenance],["admin",adminDir,beforeAdmin]]){
      try{deploySpecs(dir,snapshot,`Restore pre-L2 ${tag}`);const after=deployment(dir);if(!sameDeployment(snapshot,after))throw new Error("WORKER_DEPLOYMENT_RESTORE_MISMATCH");console.log(JSON.stringify({event:"L2_WORKER_DEPLOYMENT_RESTORED",worker:name,versions:snapshot,secrets_redacted:true}))}
      catch(error){restoreErrors.push({worker:name,error:String(error?.message||error)});console.error(JSON.stringify({event:"L2_WORKER_DEPLOYMENT_RESTORE_FAILED",worker:name,error:String(error?.message||error)}))}
    }
  }
  if(restoreErrors.length)throw Object.assign(new Error("L2_WORKER_DEPLOYMENT_RESTORE_FAILED"),{details:restoreErrors,cause:primaryError});
  if(primaryError)throw primaryError;
  return result;
}
const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invoked)main().catch(error=>{console.error(JSON.stringify({ok:false,event:"L2_EXPERT_ROUTE_ACCEPTANCE_FATAL",error:String(error?.message||error),details:error?.details||null,secrets_redacted:true}));process.exitCode=1});
