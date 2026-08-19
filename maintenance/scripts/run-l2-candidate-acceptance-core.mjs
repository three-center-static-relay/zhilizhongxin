#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const WORKER="maintenance-worker";
const COMMIT_PATTERN=/^[a-f0-9]{40}$/i;
const TAG_PATTERN=/^[a-f0-9]{12}$/i;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS=120000;
let phase="boot";

function mark(next,details={}){
  phase=next;
  console.log(JSON.stringify({event:"L2_STAGE_PROBE_PHASE",phase,at:new Date().toISOString(),...details,secrets_redacted:true}));
}
function cleanJson(text){
  const raw=String(text||"").replace(/\x1b\[[0-9;]*m/g,"").trim();
  const starts=[raw.indexOf("["),raw.indexOf("{")].filter(i=>i>=0).sort((a,b)=>a-b);
  if(!starts.length)throw new Error("WRANGLER_JSON_MISSING");
  return JSON.parse(raw.slice(starts[0]));
}
function run(args,{json=false}={}){
  const r=spawnSync("npx",["--yes",`wrangler@${WRANGLER}`,...args],{
    cwd:process.cwd(),encoding:"utf8",env:{...process.env,CI:"1"},maxBuffer:8*1024*1024,timeout:TIMEOUT_MS,killSignal:"SIGTERM"
  });
  if(r.error?.code==="ETIMEDOUT")throw Object.assign(new Error(`WRANGLER_TIMEOUT:${args.join(" ")}`),{stdout:r.stdout,stderr:r.stderr});
  if(r.error||r.status!==0)throw Object.assign(new Error(`WRANGLER_FAILED:${args.join(" ")}`),{stdout:r.stdout,stderr:r.stderr});
  if(r.stdout)process.stdout.write(r.stdout);
  if(r.stderr)process.stderr.write(r.stderr);
  return json?cleanJson(r.stdout):null;
}
function idOf(value){return String(value?.version_id||value?.versionId||value?.id||"").trim()}
function tagOf(value){return String(value?.tag||value?.annotations?.["workers/tag"]||"").trim()}
export function findVersionByTag(payload,tag){
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.versions)?payload.versions:Array.isArray(payload?.result)?payload.result:[];
  const hits=rows.filter(row=>tagOf(row)===tag&&UUID_PATTERN.test(idOf(row)));
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
  if(candidate===stable)return snapshot;
  return[{id:stable,percentage:100},{id:candidate,percentage:0}];
}
function deploy(rows,message){
  const specs=rows.map(v=>`${v.id}@${v.percentage}%`);
  run(["versions","deploy",...specs,"-y","--name",WORKER,"--message",message]);
}
function normalize(rows){return [...rows].map(v=>({id:v.id,percentage:Number(v.percentage)})).sort((a,b)=>a.id.localeCompare(b.id))}
export function sameSnapshot(a,b){return JSON.stringify(normalize(a))===JSON.stringify(normalize(b))}
function snapshot(){return currentDeployment(run(["deployments","status","--name",WORKER,"--json"],{json:true}))}

async function main(){
  mark("trigger-read");
  const request=JSON.parse(readFileSync("l2-acceptance-request.json","utf8"));
  if(request?.schema!=="expert-l2-acceptance-v1"||request?.enabled!==true)throw new Error("L2_TRIGGER_INVALID");
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!COMMIT_PATTERN.test(commit))throw new Error("L2_COMMIT_SHA_INVALID");
  const tag=commit.slice(0,12);
  if(!TAG_PATTERN.test(tag))throw new Error("L2_TAG_INVALID");

  mark("version-upload-begin",{worker:WORKER,candidate_tag:tag,secret_value_read_by_build:false});
  run(["versions","upload","--name",WORKER,"--tag",tag,"--message",`PR49 stage probe ${tag}`]);
  mark("version-upload-complete",{worker:WORKER,candidate_tag:tag});

  const candidate=findVersionByTag(run(["versions","list","--name",WORKER,"--json"],{json:true}),tag);
  const before=snapshot();
  const staged=stageSpecs(before,candidate);
  let stagedApplied=false;
  let primaryError=null;
  try{
    mark("stage-zero-begin",{candidate_version:candidate,stable_version:stableVersion(before),production_candidate_percentage:0});
    deploy(staged,`PR49 0% stage probe ${tag}`);
    stagedApplied=true;
    const observed=snapshot();
    const candidateObserved=observed.find(v=>v.id===candidate);
    if(!candidateObserved||Math.abs(candidateObserved.percentage)>0.001)throw new Error("CANDIDATE_NOT_STAGED_AT_ZERO");
    if(stableVersion(observed)!==stableVersion(before))throw new Error("STABLE_VERSION_CHANGED_DURING_PROBE");
    mark("stage-zero-verified",{candidate_version:candidate,production_candidate_percentage:0});
  }catch(error){primaryError=error}

  const cleanupErrors=[];
  if(stagedApplied){
    try{
      mark("restore-begin");
      deploy(before,`PR49 stage probe restore ${tag}`);
      const restored=snapshot();
      if(!sameSnapshot(before,restored))throw new Error("DEPLOYMENT_RESTORE_MISMATCH");
      mark("restore-verified");
    }catch(error){cleanupErrors.push(String(error?.message||error))}
  }
  if(primaryError)throw Object.assign(primaryError,{cleanup_errors:cleanupErrors});
  if(cleanupErrors.length)throw Object.assign(new Error("L2_STAGE_PROBE_CLEANUP_FAILED"),{cleanup_errors:cleanupErrors});

  console.log(JSON.stringify({event:"L2_MAINTENANCE_STAGE_RESTORE_PROBE_PASS",ok:true,worker:WORKER,commit_sha:commit,candidate_tag:tag,candidate_version:candidate,production_candidate_percentage:0,version_upload:true,stage_zero:true,restore_verified:true,build_secret_value_read:false,ai_gateway_called:false,dynamic_routes_mutated:false,secrets_redacted:true}));
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main().catch(error=>{
  console.error(JSON.stringify({event:"L2_MAINTENANCE_STAGE_RESTORE_PROBE_FAIL",phase,error:String(error?.message||error),cleanup_errors:error?.cleanup_errors||[],secrets_redacted:true}));
  process.exitCode=1;
});