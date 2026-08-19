#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const ADMIN="admin-worker";
const COMMIT_PATTERN=/^[a-f0-9]{40}$/i;
const TAG_PATTERN=/^[a-f0-9]{12}$/i;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRANGLER_TIMEOUT_MS=120000;
const ADMIN_WAIT_TIMEOUT_MS=120000;
let phase="boot";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function mark(next,details={}){
  phase=next;
  console.log(JSON.stringify({event:"L2_ADMIN_ZERO_STAGE_PROBE_PHASE",phase,at:new Date().toISOString(),...details,secrets_redacted:true}));
}
function cleanJson(text){
  const raw=String(text||"").replace(/\x1b\[[0-9;]*m/g,"").trim();
  const starts=[raw.indexOf("["),raw.indexOf("{")].filter(i=>i>=0).sort((a,b)=>a-b);
  if(!starts.length)throw new Error("WRANGLER_JSON_MISSING");
  return JSON.parse(raw.slice(starts[0]));
}
function run(args,{json=false}={}){
  const result=spawnSync("npx",["--yes",`wrangler@${WRANGLER}`,...args],{
    cwd:process.cwd(),encoding:"utf8",env:{...process.env,CI:"1"},maxBuffer:8*1024*1024,timeout:WRANGLER_TIMEOUT_MS,killSignal:"SIGTERM"
  });
  if(result.error?.code==="ETIMEDOUT")throw Object.assign(new Error(`WRANGLER_TIMEOUT:${args.join(" ")}`),{stdout:result.stdout,stderr:result.stderr});
  if(result.error||result.status!==0)throw Object.assign(new Error(`WRANGLER_FAILED:${args.join(" ")}`),{stdout:result.stdout,stderr:result.stderr});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  return json?cleanJson(result.stdout):null;
}
function idOf(value){return String(value?.version_id||value?.versionId||value?.id||"").trim()}
function tagOf(value){return String(value?.tag||value?.annotations?.["workers/tag"]||"").trim()}
export function findVersionByTag(payload,tag){
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.versions)?payload.versions:Array.isArray(payload?.result)?payload.result:[];
  const hits=rows.filter(row=>tagOf(row)===tag&&UUID_PATTERN.test(idOf(row)));
  if(hits.length!==1)throw new Error(`CANDIDATE_VERSION_TAG_MATCH:${tag}:${hits.length}`);
  return idOf(hits[0]);
}
async function waitVersionByTag(worker,tag,timeoutMs=ADMIN_WAIT_TIMEOUT_MS){
  const deadline=Date.now()+timeoutMs;let lastError=null;
  while(Date.now()<deadline){
    try{return findVersionByTag(run(["versions","list","--name",worker,"--json"],{json:true}),tag)}
    catch(error){lastError=error;await sleep(3000)}
  }
  throw lastError||new Error(`CANDIDATE_NOT_FOUND:${worker}:${tag}`);
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
  const deployment=deploymentRows(payload)[0];
  if(!deployment)throw new Error("CURRENT_DEPLOYMENT_MISSING");
  const rows=versionRows(deployment).map(v=>({id:idOf(v),percentage:Number(v.percentage)})).filter(v=>UUID_PATTERN.test(v.id));
  if(!rows.length){
    const id=idOf(deployment);
    if(UUID_PATTERN.test(id))return[{id,percentage:100}];
    throw new Error("CURRENT_DEPLOYMENT_VERSIONS_MISSING");
  }
  if(rows.length===1&&!Number.isFinite(rows[0].percentage))rows[0].percentage=100;
  if(rows.some(v=>!Number.isFinite(v.percentage)))throw new Error("CURRENT_DEPLOYMENT_PERCENTAGE_MISSING");
  const total=rows.reduce((sum,v)=>sum+v.percentage,0);
  if(Math.abs(total-100)>0.001)throw new Error("CURRENT_DEPLOYMENT_PERCENTAGE_INVALID");
  return rows;
}
export function stableVersion(snapshot){
  const stable=snapshot.find(v=>Math.abs(v.percentage-100)<0.001);
  if(!stable||!UUID_PATTERN.test(stable.id))throw new Error("CURRENT_DEPLOYMENT_NOT_100_STABLE");
  if(snapshot.some(v=>v.id!==stable.id&&v.percentage>0))throw new Error("CURRENT_DEPLOYMENT_HAS_ACTIVE_SPLIT");
  return stable.id;
}
export function stageSpecs(snapshot,candidate){
  if(!UUID_PATTERN.test(candidate))throw new Error("CANDIDATE_VERSION_INVALID");
  const stable=stableVersion(snapshot);
  if(candidate===stable)throw new Error("ADMIN_CANDIDATE_ALREADY_STABLE");
  return[{id:stable,percentage:100},{id:candidate,percentage:0}];
}
function normalize(rows){return [...rows].map(v=>({id:v.id,percentage:Number(v.percentage)})).sort((a,b)=>a.id.localeCompare(b.id))}
export function sameSnapshot(a,b){return JSON.stringify(normalize(a))===JSON.stringify(normalize(b))}
function snapshot(){return currentDeployment(run(["deployments","status","--name",ADMIN,"--json"],{json:true}))}
function deploy(rows,message){
  const specs=rows.map(v=>`${v.id}@${v.percentage}%`);
  run(["versions","deploy",...specs,"-y","--name",ADMIN,"--message",message]);
}
function verifyZeroStage(before,candidate){
  const observed=snapshot();
  const row=observed.find(v=>v.id===candidate);
  if(!row||Math.abs(row.percentage)>0.001)throw new Error("ADMIN_CANDIDATE_NOT_STAGED_AT_ZERO");
  if(stableVersion(observed)!==stableVersion(before))throw new Error("ADMIN_STABLE_VERSION_CHANGED");
  return observed;
}

async function main(){
  mark("trigger-read");
  const request=JSON.parse(readFileSync("l2-acceptance-request.json","utf8"));
  if(request?.schema!=="expert-l2-acceptance-v1"||request?.enabled!==true)throw new Error("L2_TRIGGER_INVALID");
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!COMMIT_PATTERN.test(commit))throw new Error("L2_COMMIT_SHA_INVALID");
  const tag=commit.slice(0,12);
  if(!TAG_PATTERN.test(tag))throw new Error("L2_TAG_INVALID");

  mark("admin-candidate-resolution-begin",{worker:ADMIN,candidate_tag:tag});
  const candidate=await waitVersionByTag(ADMIN,tag);
  const before=snapshot();
  const stable=stableVersion(before);
  if(candidate===stable)throw new Error("ADMIN_CANDIDATE_ALREADY_STABLE");
  mark("admin-stage-zero-begin",{admin_stable_version:stable,admin_candidate_version:candidate,production_candidate_percentage:0});

  let staged=false;let primaryError=null;
  try{
    deploy(stageSpecs(before,candidate),`PR49 admin 0% stage probe ${tag}`);
    staged=true;
    verifyZeroStage(before,candidate);
    mark("admin-stage-zero-verified",{admin_stable_version:stable,admin_candidate_version:candidate,production_candidate_percentage:0});
  }catch(error){primaryError=error}

  const cleanupErrors=[];
  if(staged){
    try{
      mark("admin-restore-begin");
      deploy(before,`PR49 admin stage probe restore ${tag}`);
      const restored=snapshot();
      if(!sameSnapshot(before,restored))throw new Error("ADMIN_DEPLOYMENT_RESTORE_MISMATCH");
      mark("admin-restore-verified");
    }catch(error){cleanupErrors.push(String(error?.message||error))}
  }
  if(primaryError)throw Object.assign(primaryError,{cleanup_errors:cleanupErrors});
  if(cleanupErrors.length)throw Object.assign(new Error("ADMIN_STAGE_PROBE_CLEANUP_FAILED"),{cleanup_errors:cleanupErrors});

  console.log(JSON.stringify({event:"L2_ADMIN_ZERO_STAGE_RESTORE_PROBE_PASS",ok:true,commit_sha:commit,candidate_tag:tag,admin_version:candidate,admin_stable_version:stable,admin_candidate_percentage:0,admin_stage_zero:true,admin_restore_verified:true,maintenance_deployment_mutated:false,maintenance_version_upload:false,remote_dev:false,build_secret_value_read:false,ai_gateway_called:false,dynamic_routes_mutated:false,secrets_redacted:true}));
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main().catch(error=>{
  console.error(JSON.stringify({event:"L2_ADMIN_ZERO_STAGE_RESTORE_PROBE_FAIL",phase,error:String(error?.message||error),cleanup_errors:error?.cleanup_errors||[],secrets_redacted:true}));
  process.exitCode=1;
});