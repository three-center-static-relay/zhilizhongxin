#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const ADMIN="admin-worker";
const MAINTENANCE="maintenance-worker";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{40}$/i;
const TAG=/^[a-f0-9]{12}$/i;
const COMMAND_TIMEOUT_MS=120000;
const HTTP_TIMEOUT_MS=360000;
const GLOBAL_TIMEOUT_MS=720000;
const ADMIN_DRIVER_TTL_MS=720000;
const startedAt=Date.now();
let phase="boot";
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function mark(next,details={}){
  phase=next;
  console.log(JSON.stringify({event:"L2_ADMIN_RUNTIME_ACCEPTANCE_PHASE",phase,at:new Date().toISOString(),...details,secrets_redacted:true}));
}
function deadline(){
  if(Date.now()-startedAt>GLOBAL_TIMEOUT_MS)throw new Error("L2_GLOBAL_DEADLINE_EXCEEDED");
}
function cleanJson(text){
  const raw=String(text||"").replace(/\x1b\[[0-9;]*m/g,"").trim();
  const starts=[raw.indexOf("["),raw.indexOf("{")].filter(index=>index>=0).sort((a,b)=>a-b);
  if(!starts.length)throw new Error("WRANGLER_JSON_MISSING");
  return JSON.parse(raw.slice(starts[0]));
}
function run(args,{cwd=process.cwd(),json=false,outputPath=null}={}){
  deadline();
  const env={...process.env,CI:"1",WRANGLER_LOG_SANITIZE:"true",...(outputPath?{WRANGLER_OUTPUT_FILE_PATH:outputPath}:{})};
  const result=spawnSync("npx",["--yes",`wrangler@${WRANGLER}`,...args],{
    cwd,encoding:"utf8",env,maxBuffer:8*1024*1024,timeout:COMMAND_TIMEOUT_MS,killSignal:"SIGTERM"
  });
  if(result.error?.code==="ETIMEDOUT")throw Object.assign(new Error(`WRANGLER_TIMEOUT:${args.join(" ")}`),{stdout:result.stdout,stderr:result.stderr});
  if(result.error||result.status!==0)throw Object.assign(new Error(`WRANGLER_FAILED:${args.join(" ")}`),{stdout:result.stdout,stderr:result.stderr});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  return json?cleanJson(result.stdout):result;
}
function idOf(value){return String(value?.version_id||value?.versionId||value?.id||"").trim()}
function tagOf(value){return String(value?.tag||value?.annotations?.["workers/tag"]||"").trim()}
function versionRows(payload){
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payload?.versions))return payload.versions;
  if(Array.isArray(payload?.result))return payload.result;
  return[];
}
function findVersionByTag(payload,tag){
  const hits=versionRows(payload).filter(row=>tagOf(row)===tag&&UUID.test(idOf(row)));
  if(!hits.length)throw new Error(`CANDIDATE_VERSION_TAG_MATCH:${tag}:0`);
  return idOf(hits[0]);
}
function deploymentRows(payload){
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payload?.deployments))return payload.deployments;
  if(Array.isArray(payload?.result))return payload.result;
  if(payload&&typeof payload==="object")return[payload];
  return[];
}
function currentDeployment(payload){
  const deployment=deploymentRows(payload)[0];
  if(!deployment)throw new Error("CURRENT_DEPLOYMENT_MISSING");
  const raw=Array.isArray(deployment?.versions)?deployment.versions:Array.isArray(deployment?.deployment?.versions)?deployment.deployment.versions:[];
  const rows=raw.map(value=>({id:idOf(value),percentage:Number(value.percentage)})).filter(value=>UUID.test(value.id));
  if(!rows.length){
    const id=idOf(deployment);
    if(UUID.test(id))return[{id,percentage:100}];
    throw new Error("CURRENT_DEPLOYMENT_VERSIONS_MISSING");
  }
  if(rows.length===1&&!Number.isFinite(rows[0].percentage))rows[0].percentage=100;
  if(rows.some(value=>!Number.isFinite(value.percentage)))throw new Error("CURRENT_DEPLOYMENT_PERCENTAGE_MISSING");
  if(Math.abs(rows.reduce((sum,value)=>sum+value.percentage,0)-100)>0.001)throw new Error("CURRENT_DEPLOYMENT_PERCENTAGE_INVALID");
  return rows;
}
function stableVersion(snapshot){
  const stable=snapshot.find(value=>Math.abs(value.percentage-100)<0.001);
  if(!stable||!UUID.test(stable.id))throw new Error("CURRENT_DEPLOYMENT_NOT_100_STABLE");
  if(snapshot.some(value=>value.id!==stable.id&&value.percentage>0))throw new Error("CURRENT_DEPLOYMENT_HAS_ACTIVE_SPLIT");
  return stable.id;
}
function normalize(snapshot){return [...snapshot].map(value=>({id:value.id,percentage:Number(value.percentage)})).sort((a,b)=>a.id.localeCompare(b.id))}
function sameSnapshot(left,right){return JSON.stringify(normalize(left))===JSON.stringify(normalize(right))}
function snapshot(worker,cwd){return currentDeployment(run(["deployments","status","--name",worker,"--json"],{cwd,json:true}))}
function deploySnapshot(worker,rows,message,cwd){
  const specs=rows.map(value=>`${value.id}@${value.percentage}%`);
  run(["versions","deploy",...specs,"-y","--name",worker,"--message",message],{cwd});
}
function parseDeployOutput(path){
  const rows=readFileSync(path,"utf8").split(/\r?\n/).map(line=>line.trim()).filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});
  const deploy=[...rows].reverse().find(value=>value?.type==="deploy");
  if(!deploy)throw new Error("ADMIN_DEPLOY_STRUCTURED_OUTPUT_MISSING");
  const versionId=String(deploy.version_id||"").trim();
  if(!UUID.test(versionId))throw new Error("ADMIN_DEPLOY_VERSION_INVALID");
  const target=(Array.isArray(deploy.targets)?deploy.targets:[]).map(String).find(value=>/^https:\/\/[A-Za-z0-9.-]+\.workers\.dev\/?$/.test(value));
  if(!target)throw new Error("ADMIN_WORKERS_DEV_TARGET_MISSING");
  return{versionId,target};
}
function prepareAdminConfig(adminDir,nonce,expiresAt,commit){
  const source=JSON.parse(readFileSync(resolve(adminDir,"wrangler.jsonc"),"utf8"));
  if(!source?.exports?.AdminCoordinator||!source?.durable_objects?.bindings?.length)throw new Error("ADMIN_LIFECYCLE_CONFIG_REQUIRED");
  const control=source?.services?.find(binding=>binding?.binding==="MAINTENANCE_CONTROL");
  if(control?.service!==MAINTENANCE||control?.entrypoint!=="MaintenanceControl")throw new Error("ADMIN_MAINTENANCE_CONTROL_BINDING_REQUIRED");
  const config=JSON.parse(JSON.stringify(source));
  delete config.secrets;
  config.keep_vars=true;
  config.vars={...(config.vars||{}),L2_ACCEPTANCE_EXPIRES_AT:String(expiresAt),L2_ACCEPTANCE_COMMIT:commit};
  const path=resolve(adminDir,".l2-admin-runtime.wrangler.jsonc");
  writeFileSync(path,JSON.stringify(config,null,2));
  return path;
}
async function callAdmin(target,nonce,payload,expectedAdminVersion){
  const deadlineAt=Math.min(startedAt+GLOBAL_TIMEOUT_MS,Date.now()+HTTP_TIMEOUT_MS);
  let last=null;
  while(Date.now()<deadlineAt){
    deadline();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(45000,deadlineAt-Date.now()));
    try{
      const response=await fetch(new URL("/v1/admin/l2/maintenance-candidate",target),{
        method:"POST",
        headers:{authorization:`Bearer ${nonce}`,accept:"application/json","content-type":"application/json"},
        body:JSON.stringify(payload),signal:controller.signal
      });
      const body=await response.json().catch(()=>null);
      if(response.status===404||body?.admin_version!==expectedAdminVersion){last=new Error(`ADMIN_DRIVER_NOT_PROPAGATED:${response.status}`);await sleep(1500);continue}
      return{response,body};
    }catch(error){last=error;await sleep(1500)}
    finally{clearTimeout(timer)}
  }
  throw last||new Error("ADMIN_DRIVER_HTTP_TIMEOUT");
}

async function main(){
  mark("trigger-read");
  const adminDir=process.cwd(),maintenanceDir=resolve(adminDir,"..","maintenance");
  const request=JSON.parse(readFileSync("l2-acceptance-request.json","utf8"));
  if(request?.schema!=="expert-l2-acceptance-v1"||request?.enabled!==true)throw new Error("L2_TRIGGER_INVALID");
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!SHA.test(commit))throw new Error("L2_COMMIT_SHA_INVALID");
  const tag=commit.slice(0,12);
  if(!TAG.test(tag))throw new Error("L2_TAG_INVALID");
  const nonce=randomBytes(32).toString("base64url");
  const expiresAt=Date.now()+ADMIN_DRIVER_TTL_MS;
  const workDir=resolve(adminDir,".l2-runtime-acceptance");
  const adminOutput=resolve(workDir,"admin-deploy.ndjson");
  mkdirSync(workDir,{recursive:true});
  const adminConfig=prepareAdminConfig(adminDir,nonce,expiresAt,commit);
  const nonceSecretPath=resolve(workDir,"admin-l2-secret.json");
  writeFileSync(nonceSecretPath,JSON.stringify({L2_ACCEPTANCE_NONCE:nonce}));

  const adminBefore=snapshot(ADMIN,adminDir);
  const maintenanceBefore=snapshot(MAINTENANCE,maintenanceDir);
  if(adminBefore.length!==1||Math.abs(adminBefore[0].percentage-100)>0.001)throw new Error("ADMIN_PRETEST_DEPLOYMENT_NOT_SINGLE_STABLE");
  stableVersion(maintenanceBefore);
  let maintenanceStaged=false,adminDeployed=false,primaryError=null,receipt=null,adminCandidate=null,maintenanceCandidate=null;

  try{
    mark("maintenance-version-upload-begin",{worker:MAINTENANCE,candidate_tag:tag});
    run(["versions","upload","--name",MAINTENANCE,"--tag",tag,"--message",`PR49 L2 maintenance candidate ${tag}`],{cwd:maintenanceDir});
    maintenanceCandidate=findVersionByTag(run(["versions","list","--name",MAINTENANCE,"--json"],{cwd:maintenanceDir,json:true}),tag);
    mark("maintenance-version-upload-complete",{maintenance_version:maintenanceCandidate});

    const staged=[{id:stableVersion(maintenanceBefore),percentage:100},{id:maintenanceCandidate,percentage:0}];
    mark("maintenance-stage-zero-begin",{maintenance_version:maintenanceCandidate,production_candidate_percentage:0});
    deploySnapshot(MAINTENANCE,staged,`PR49 L2 maintenance 0% ${tag}`,maintenanceDir);
    maintenanceStaged=true;
    const observed=snapshot(MAINTENANCE,maintenanceDir);
    const candidateRow=observed.find(value=>value.id===maintenanceCandidate);
    if(!candidateRow||Math.abs(candidateRow.percentage)>0.001||stableVersion(observed)!==stableVersion(maintenanceBefore))throw new Error("MAINTENANCE_ZERO_STAGE_VERIFY_FAILED");
    mark("maintenance-stage-zero-verified",{maintenance_version:maintenanceCandidate});

    mark("admin-ephemeral-driver-deploy-begin",{worker:ADMIN,full_single_version:true,nonce_logged:false,expires_at:new Date(expiresAt).toISOString()});
    run(["deploy","--config",adminConfig,"--keep-vars","--secrets-file",nonceSecretPath,"--tag",tag,"--message",`PR49 L2 ephemeral admin driver ${tag}`],{cwd:adminDir,outputPath:adminOutput});
    adminDeployed=true;
    const parsed=parseDeployOutput(adminOutput);adminCandidate=parsed.versionId;
    const adminObserved=snapshot(ADMIN,adminDir);
    if(adminObserved.length!==1||adminObserved[0].id!==adminCandidate||Math.abs(adminObserved[0].percentage-100)>0.001)throw new Error("ADMIN_EPHEMERAL_DEPLOY_VERIFY_FAILED");
    mark("admin-ephemeral-driver-deploy-verified",{admin_version:adminCandidate,target_present:true});

    const requestId=`pr49:${tag}:${String(process.env.WORKERS_CI_BUILD_UUID||"build").replace(/[^A-Za-z0-9._:-]/g,"").slice(0,64)}`;
    mark("candidate-runtime-rehearsal-begin",{admin_version:adminCandidate,maintenance_version:maintenanceCandidate,version_override:true});
    const call=await callAdmin(parsed.target,nonce,{request_id:requestId,commit_sha:commit,admin_version:adminCandidate,maintenance_version:maintenanceCandidate},adminCandidate);
    const body=call.body;
    const checks=body?.checks||{};
    const required=["admin_version_exact","maintenance_version_override_exact","route_family_eight","company_lanes_eight","expert_selftest_ok","company_diverse","route_rollback_ok"];
    if(!call.response.ok||body?.ok!==true||required.some(key=>checks[key]!==true))throw Object.assign(new Error("L2_RUNTIME_ACCEPTANCE_FAILED"),{details:{http_status:call.response.status,body}});
    receipt=body;
    mark("candidate-runtime-rehearsal-pass",{admin_version:adminCandidate,maintenance_version:maintenanceCandidate,route_family_count:8,company_lane_count:8,expert_selftest:true,route_rollback:true});
  }catch(error){primaryError=error}

  const cleanupErrors=[];
  try{
    const now=snapshot(ADMIN,adminDir);
    if(adminDeployed||!sameSnapshot(now,adminBefore)){
      mark("admin-restore-begin");
      deploySnapshot(ADMIN,adminBefore,`PR49 L2 admin restore ${tag}`,adminDir);
      const restored=snapshot(ADMIN,adminDir);
      if(!sameSnapshot(adminBefore,restored))throw new Error("ADMIN_DEPLOYMENT_RESTORE_MISMATCH");
      mark("admin-restore-verified");
    }
  }catch(error){cleanupErrors.push({worker:ADMIN,error:String(error?.message||error)})}
  try{
    const now=snapshot(MAINTENANCE,maintenanceDir);
    if(maintenanceStaged||!sameSnapshot(now,maintenanceBefore)){
      mark("maintenance-restore-begin");
      deploySnapshot(MAINTENANCE,maintenanceBefore,`PR49 L2 maintenance restore ${tag}`,maintenanceDir);
      const restored=snapshot(MAINTENANCE,maintenanceDir);
      if(!sameSnapshot(maintenanceBefore,restored))throw new Error("MAINTENANCE_DEPLOYMENT_RESTORE_MISMATCH");
      mark("maintenance-restore-verified");
    }
  }catch(error){cleanupErrors.push({worker:MAINTENANCE,error:String(error?.message||error)})}
  rmSync(adminConfig,{force:true});rmSync(workDir,{recursive:true,force:true});

  if(primaryError)throw Object.assign(primaryError,{cleanup_errors:cleanupErrors});
  if(cleanupErrors.length)throw Object.assign(new Error("L2_DEPLOYMENT_CLEANUP_FAILED"),{cleanup_errors:cleanupErrors});
  console.log(JSON.stringify({event:"L2_ADMIN_DRIVEN_RUNTIME_ACCEPTANCE_PASS",ok:true,commit_sha:commit,admin_candidate_version:adminCandidate,maintenance_candidate_version:maintenanceCandidate,maintenance_candidate_percentage:0,version_override_verified:true,route_family_count:8,company_lane_count:8,expert_selftest_ok:true,company_diverse:true,route_rollback_verified:true,admin_deployment_restored:true,maintenance_deployment_restored:true,nonce_active_after_restore:false,nonce_ttl_ms:ADMIN_DRIVER_TTL_MS,nonce_value_logged:false,secrets_redacted:true,receipt_digest_fields:{request_id:receipt?.request_id||null,plan_digest:receipt?.result?.plan_digest||null}}));
}

if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main().catch(error=>{
  console.error(JSON.stringify({event:"L2_ADMIN_DRIVEN_RUNTIME_ACCEPTANCE_FAIL",phase,error:String(error?.message||error),cleanup_errors:error?.cleanup_errors||[],details:error?.details?{http_status:error.details.http_status||null,error:error.details.body?.error||null}:null,secrets_redacted:true}));
  process.exitCode=1;
});
