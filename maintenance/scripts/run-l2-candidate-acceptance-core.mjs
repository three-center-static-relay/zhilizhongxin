#!/usr/bin/env node
import {spawn,spawnSync} from "node:child_process";
import {mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const ACCOUNT_ID="e3aec027af13c557bbcb831d29c1e7b4";
const MAINTENANCE="maintenance-worker";
const OVERRIDE_HEADER="Cloudflare-Workers-Version-Overrides";
const TAG_PATTERN=/^[a-f0-9]{12}$/i;
const COMMIT_PATTERN=/^[a-f0-9]{40}$/i;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRANGLER_TIMEOUT_MS=90000;
const CANDIDATE_WAIT_TIMEOUT_MS=90000;
const REMOTE_READY_TIMEOUT_MS=60000;
const REMOTE_RUN_TIMEOUT_MS=300000;
const EXECUTION_DEADLINE_MS=12*60*1000;
let currentPhase="boot";
let executionDeadlineAt=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function markPhase(phase,details={}){
  currentPhase=phase;
  console.log(JSON.stringify({event:"L2_PHASE",phase,at:new Date().toISOString(),...details,secrets_redacted:true}));
}
function beginDeadline(){executionDeadlineAt=Date.now()+EXECUTION_DEADLINE_MS}
function boundedTimeout(cap,enforceDeadline=true){
  if(!enforceDeadline||!executionDeadlineAt)return cap;
  const remaining=executionDeadlineAt-Date.now();
  if(remaining<=5000)throw new Error("L2_EXECUTION_DEADLINE_EXCEEDED");
  return Math.max(1000,Math.min(cap,remaining-5000));
}
function assertWithinDeadline(){boundedTimeout(60000,true)}

function cleanJson(text){
  const raw=String(text||"").replace(/\x1b\[[0-9;]*m/g,"").trim();
  const starts=[raw.indexOf("["),raw.indexOf("{")].filter(i=>i>=0).sort((a,b)=>a-b);
  if(!starts.length)throw new Error("WRANGLER_JSON_MISSING");
  return JSON.parse(raw.slice(starts[0]));
}
function runJson(args,{enforceDeadline=true,timeoutMs=WRANGLER_TIMEOUT_MS}={}){
  const timeout=boundedTimeout(timeoutMs,enforceDeadline);
  const r=spawnSync("npx",["--yes",`wrangler@${WRANGLER}`,...args],{encoding:"utf8",env:{...process.env,CI:"1"},maxBuffer:4*1024*1024,timeout,killSignal:"SIGTERM"});
  if(r.error?.code==="ETIMEDOUT")throw Object.assign(new Error(`WRANGLER_TIMEOUT:${args.join(" ")}`),{stderr:r.stderr,stdout:r.stdout});
  if(r.error||r.status!==0)throw Object.assign(new Error(`WRANGLER_FAILED:${args.join(" ")}`),{stderr:r.stderr,stdout:r.stdout});
  return cleanJson(r.stdout);
}
function run(args,{enforceDeadline=true,timeoutMs=WRANGLER_TIMEOUT_MS}={}){
  const timeout=boundedTimeout(timeoutMs,enforceDeadline);
  const r=spawnSync("npx",["--yes",`wrangler@${WRANGLER}`,...args],{encoding:"utf8",env:{...process.env,CI:"1"},stdio:"inherit",timeout,killSignal:"SIGTERM"});
  if(r.error?.code==="ETIMEDOUT")throw new Error(`WRANGLER_TIMEOUT:${args.join(" ")}`);
  if(r.error||r.status!==0)throw new Error(`WRANGLER_FAILED:${args.join(" ")}`);
}
function idOf(x){return String(x?.version_id||x?.versionId||x?.id||"").trim()}
function tagOf(x){return String(x?.tag||x?.annotations?.["workers/tag"]||"").trim()}
export function findVersionByTag(payload,tag){
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.versions)?payload.versions:Array.isArray(payload?.result)?payload.result:[];
  const hits=rows.filter(x=>tagOf(x)===tag&&UUID_PATTERN.test(idOf(x)));
  if(hits.length!==1)throw new Error(`CANDIDATE_VERSION_TAG_MATCH:${tag}:${hits.length}`);
  return idOf(hits[0]);
}
function deploymentRows(payload){
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payload?.deployments))return payload.deployments;
  if(Array.isArray(payload?.result))return payload.result;
  if(payload&&typeof payload==="object")return[payload];
  return[];
}
function versionRows(deployment){
  if(Array.isArray(deployment?.versions))return deployment.versions;
  if(Array.isArray(deployment?.deployment?.versions))return deployment.deployment.versions;
  return[];
}
export function currentDeployment(payload){
  const dep=deploymentRows(payload)[0];
  if(!dep)throw new Error("CURRENT_DEPLOYMENT_MISSING");
  const rows=versionRows(dep).map(v=>({id:idOf(v),percentage:Number(v.percentage)})).filter(v=>UUID_PATTERN.test(v.id));
  if(!rows.length){
    const id=idOf(dep);
    if(UUID_PATTERN.test(id))return[{id,percentage:100}];
    throw new Error("CURRENT_DEPLOYMENT_VERSIONS_MISSING");
  }
  if(rows.length===1&&!Number.isFinite(rows[0].percentage))rows[0].percentage=100;
  if(rows.some(v=>!Number.isFinite(v.percentage)))throw new Error("CURRENT_DEPLOYMENT_PERCENTAGE_MISSING");
  const sum=rows.reduce((s,v)=>s+v.percentage,0);
  if(Math.abs(sum-100)>0.001)throw new Error("CURRENT_DEPLOYMENT_PERCENTAGE_INVALID");
  return rows;
}
export function stableVersion(snapshot){
  const stable=snapshot.find(v=>Math.abs(v.percentage-100)<0.001);
  if(!stable)throw new Error("CURRENT_DEPLOYMENT_NOT_100_STABLE");
  if(snapshot.some(v=>v.percentage>0&&v.id!==stable.id))throw new Error("CURRENT_DEPLOYMENT_HAS_ACTIVE_SPLIT");
  if(!UUID_PATTERN.test(stable.id))throw new Error("CURRENT_STABLE_VERSION_INVALID");
  return stable.id;
}
export function stageSpecs(snapshot,candidate){
  if(!UUID_PATTERN.test(candidate))throw new Error("CANDIDATE_VERSION_INVALID");
  const stable=stableVersion(snapshot);
  if(candidate===stable)return snapshot;
  return[{id:stable,percentage:100},{id:candidate,percentage:0}];
}
export function adminCandidateWorkerName(tag,stamp="test"){
  if(!TAG_PATTERN.test(tag))throw new Error("L2_ADMIN_CANDIDATE_TAG_INVALID");
  const suffix=String(stamp||"").toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,20)||"run";
  return `admin-l2-candidate-${tag}-${suffix}`.slice(0,63).replace(/-$/g,"");
}
function specs(rows){return rows.map(v=>`${v.id}@${v.percentage}%`)}
function deploy(worker,rows,message){run(["versions","deploy",...specs(rows),"-y","--name",worker,"--message",message])}
async function waitCandidate(worker,tag,timeoutMs=CANDIDATE_WAIT_TIMEOUT_MS){
  const end=Date.now()+Math.min(timeoutMs,boundedTimeout(timeoutMs,true));
  let last;
  while(Date.now()<end){
    assertWithinDeadline();
    try{return findVersionByTag(runJson(["versions","list","--name",worker,"--json"]),tag)}
    catch(e){last=e;await sleep(3000)}
  }
  throw last||new Error(`CANDIDATE_NOT_FOUND:${worker}:${tag}`);
}
function snapshot(worker,{enforceDeadline=true}={}){
  return currentDeployment(runJson(["deployments","status","--name",worker,"--json"],{enforceDeadline}));
}
export function validateReceipt(body,maintenanceVersion,adminCommit){
  if(body?.ok!==true)throw new Error(`L2_RESPONSE_NOT_OK:${body?.error||"unknown"}`);
  const adminVersion=String(body?.admin_version||"").trim();
  if(!UUID_PATTERN.test(adminVersion))throw new Error("ADMIN_REMOTE_DEV_VERSION_NOT_OBSERVED");
  if(!COMMIT_PATTERN.test(adminCommit))throw new Error("ADMIN_CANDIDATE_COMMIT_INVALID");
  if(body?.maintenance_version!==maintenanceVersion)throw new Error("MAINTENANCE_VERSION_OVERRIDE_NOT_APPLIED");
  if(body?.transport!=="fetch-version-override")throw new Error("ADMIN_TRANSPORT_NOT_VERSION_OVERRIDE_FETCH");
  if(body?.maintenance_transport!=="fetch")throw new Error("MAINTENANCE_TRANSPORT_NOT_FETCH");
  const result=body?.result;
  if(result?.ok!==true||result?.status!=="active")throw new Error(`ROUTE_RESULT_NOT_ACTIVE:${result?.status||"missing"}`);
  if(!Array.isArray(result.route_family)||result.route_family.length!==8)throw new Error("ROUTE_FAMILY_NOT_EIGHT");
  if(result.route_family.some(r=>!r?.route_id||!r?.version_id))throw new Error("ROUTE_FAMILY_RECEIPT_INCOMPLETE");
  if(!Array.isArray(result.company_lanes)||result.company_lanes.length!==8)throw new Error("COMPANY_LANES_NOT_EIGHT");
  const companies=new Set((result.company_lanes||[]).map(x=>String(x?.company||"").toLowerCase()).filter(Boolean));
  if(companies.size!==8)throw new Error("COMPANY_DIVERSITY_NOT_EIGHT");
  if(result.selftest?.ok!==true||result.selftest?.http_status!==200||result.selftest?.company_diverse!==true||!Array.isArray(result.selftest?.models)||result.selftest.models.length===0)throw new Error("EXPERT_SELFTEST_NOT_DIVERSE");
  if(body?.rollback_rehearsal?.ok!==true)throw new Error("ROLLBACK_REHEARSAL_NOT_COMPLETE");
  if((body.rollback_rehearsal?.mismatches||[]).length!==0)throw new Error("ROLLBACK_SNAPSHOT_MISMATCH");
  return{
    ok:true,
    admin_mode:"remote-dev-ctx-exports",
    admin_candidate_commit:adminCommit,
    admin_version:adminVersion,
    maintenance_version:maintenanceVersion,
    route_versions:result.route_family.map(r=>({route_name:r.route_name,route_id:r.route_id,version_id:r.version_id,previous_version_id:r.previous_version_id||null})),
    companies:[...companies],
    free_lane_count:Number(result.free_lane_count||0),
    selftest:{ok:true,http_status:result.selftest.http_status||0,company_diverse:true,models:Array.isArray(result.selftest.models)?result.selftest.models:[]},
    plan_digest:result.plan_digest||null,
    rollback_rehearsal:{ok:true},
    secrets_redacted:true
  };
}

function prepareAdminCandidate(name,adminCommit){
  if(!COMMIT_PATTERN.test(adminCommit))throw new Error("L2_ADMIN_CANDIDATE_COMMIT_INVALID");
  const dir=resolve(".l2-admin-candidate");
  rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"worker.mjs"),`import {AdminAcceptanceControl} from "../../admin/src/production-superguard.js";
export {AdminAcceptanceControl};
export default{async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==="/health")return Response.json({ok:true});if(request.method==="POST"&&u.pathname==="/run"){const body=await request.text();const h=new Headers({"content-type":"application/json","accept":"application/json"});const o=request.headers.get("${OVERRIDE_HEADER}");if(o)h.set("${OVERRIDE_HEADER}",o);const control=ctx.exports.AdminAcceptanceControl({props:{caller:"expert-l2-acceptance",capability:"expert-route-acceptance"}});return control.fetch(new Request("https://admin.accept/v1/control/expert-route/refresh",{method:"POST",headers:h,body}))}return Response.json({ok:false,error:"NOT_FOUND"},{status:404})}};
`);
  const configPath=resolve(dir,"wrangler.jsonc");
  writeFileSync(configPath,JSON.stringify({
    name,
    account_id:ACCOUNT_ID,
    main:"worker.mjs",
    compatibility_date:"2026-08-18",
    compatibility_flags:["nodejs_compat","enable_ctx_exports"],
    workers_dev:false,
    preview_urls:false,
    services:[{binding:"MAINTENANCE_CONTROL",service:MAINTENANCE,props:{caller:"admin-worker",capability:"expert-route-refresh"}}],
    version_metadata:{binding:"CF_VERSION_METADATA"},
    vars:{L2_ADMIN_CANDIDATE_COMMIT:adminCommit}
  },null,2));
  return{dir,configPath,name,adminCommit};
}

async function remoteHarness(adminCandidate,maintenanceVersion,requestId){
  markPhase("remote-dev-start",{admin_mode:"remote-dev-ctx-exports",admin_service:adminCandidate.name,admin_candidate_commit:adminCandidate.adminCommit,maintenance_version:maintenanceVersion,persistent_admin_write:false,ctx_exports_loopback:true});
  const child=spawn("npx",["--yes",`wrangler@${WRANGLER}`,"dev","--remote","--config",adminCandidate.configPath,"--port","8787"],{stdio:["ignore","pipe","pipe"],env:{...process.env,CI:"1"}});
  let logs=""; child.stdout.on("data",d=>logs+=d);child.stderr.on("data",d=>logs+=d);
  try{
    const readyTimeout=boundedTimeout(REMOTE_READY_TIMEOUT_MS,true),end=Date.now()+readyTimeout;let ready=false;
    while(Date.now()<end){
      assertWithinDeadline();
      if(child.exitCode!==null)throw new Error(`REMOTE_DEV_EXITED:${child.exitCode}:${logs.slice(-2000)}`);
      try{
        const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);
        try{const r=await fetch("http://127.0.0.1:8787/health",{signal:c.signal});if(r.ok){ready=true;break}}
        finally{clearTimeout(t)}
      }catch{}
      await sleep(1500);
    }
    if(!ready)throw new Error(`REMOTE_DEV_NOT_READY:${logs.slice(-2000)}`);
    markPhase("remote-dev-ready",{admin_service:adminCandidate.name,ctx_exports_loopback:true});
    const override=`${MAINTENANCE}="${maintenanceVersion}"`;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),boundedTimeout(REMOTE_RUN_TIMEOUT_MS,true));
    let response;
    try{
      markPhase("remote-run-begin",{request_id:requestId});
      response=await fetch("http://127.0.0.1:8787/run",{method:"POST",headers:{"content-type":"application/json",[OVERRIDE_HEADER]:override},body:JSON.stringify({request_id:requestId}),signal:controller.signal});
    }catch(error){
      if(error?.name==="AbortError")throw new Error("REMOTE_RUN_TIMEOUT");
      throw error;
    }finally{clearTimeout(timer)}
    markPhase("remote-run-response",{http_status:response.status});
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw Object.assign(new Error(`L2_HTTP_${response.status}`),{body});
    return validateReceipt(body,maintenanceVersion,adminCandidate.adminCommit);
  }finally{
    child.kill("SIGTERM");await Promise.race([new Promise(r=>child.once("exit",r)),sleep(5000)]);if(child.exitCode===null)child.kill("SIGKILL");
  }
}

async function main(){
  beginDeadline();
  markPhase("trigger-read");
  const request=JSON.parse(readFileSync("l2-acceptance-request.json","utf8"));
  if(request?.schema!=="expert-l2-acceptance-v1"||request?.enabled!==true)throw new Error("L2_TRIGGER_INVALID");
  const adminCommit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  const maintenanceTag=adminCommit.slice(0,12);
  if(!COMMIT_PATTERN.test(adminCommit))throw new Error("L2_COMMIT_SHA_INVALID");
  if(!TAG_PATTERN.test(maintenanceTag))throw new Error("L2_MAINTENANCE_TAG_INVALID");
  const requestId=String(request.request_id||`l2-${maintenanceTag}`);
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))throw new Error("L2_REQUEST_ID_INVALID");
  markPhase("maintenance-candidate-lookup-begin",{maintenance_candidate_tag:maintenanceTag,admin_candidate_commit:adminCommit,request_id:requestId});
  const maintenanceCandidate=await waitCandidate(MAINTENANCE,maintenanceTag);
  markPhase("snapshot-begin");
  const maintenanceSnapshot=snapshot(MAINTENANCE);
  markPhase("snapshot-complete",{admin_mode:"remote-dev-ctx-exports",maintenance_version:maintenanceCandidate});

  const candidateName=adminCandidateWorkerName(maintenanceTag,Date.now().toString(36));
  const adminCandidate=prepareAdminCandidate(candidateName,adminCommit);
  let maintenanceStaged=false,receipt=null,primaryError=null,primaryPhase=null;
  try{
    markPhase("maintenance-stage-begin");
    deploy(MAINTENANCE,stageSpecs(maintenanceSnapshot,maintenanceCandidate),`L2 0% maintenance candidate ${maintenanceTag}`);maintenanceStaged=true;
    markPhase("maintenance-stage-complete");
    await sleep(5000);assertWithinDeadline();
    markPhase("remote-harness-begin",{admin_service:candidateName,persistent_admin_write:false});
    receipt=await remoteHarness(adminCandidate,maintenanceCandidate,requestId);
  }catch(error){
    primaryError=error;primaryPhase=currentPhase;
  }

  markPhase("restore-begin",{admin_persistent_write:false,maintenance_staged:maintenanceStaged});
  const cleanupErrors=[];
  if(maintenanceStaged){
    try{deploy(MAINTENANCE,maintenanceSnapshot,`L2 restore maintenance ${maintenanceTag}`)}
    catch(error){cleanupErrors.push({resource:MAINTENANCE,error:String(error?.message||error)})}
  }
  rmSync(adminCandidate.dir,{recursive:true,force:true});
  markPhase("restore-complete",{cleanup_error_count:cleanupErrors.length});

  if(primaryError){
    if(cleanupErrors.length)primaryError.body={...(primaryError?.body||{}),cleanup_errors:cleanupErrors};
    primaryError.phase=primaryPhase;throw primaryError;
  }
  if(cleanupErrors.length)throw Object.assign(new Error("L2_CLEANUP_FAILED"),{body:{cleanup_errors:cleanupErrors},phase:"restore"});
  if(!receipt?.ok)throw Object.assign(new Error("L2_RECEIPT_MISSING"),{phase:"remote-harness"});
  console.log(JSON.stringify({event:"L2_EXPERT_ROUTE_ACCEPTANCE_PASS",admin_mode:"remote-dev-ctx-exports",admin_candidate_commit:adminCommit,maintenance_candidate_tag:maintenanceTag,request_id:requestId,...receipt}));
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main().catch(error=>{console.error(JSON.stringify({event:"L2_EXPERT_ROUTE_ACCEPTANCE_FAIL",phase:error?.phase||currentPhase,error:String(error?.message||error),details:error?.body||null,secrets_redacted:true}));process.exitCode=1});