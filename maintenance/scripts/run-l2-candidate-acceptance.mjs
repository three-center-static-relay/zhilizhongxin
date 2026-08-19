#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const ADMIN="admin-worker";
const MAINTENANCE="maintenance-worker";
const DIAG_PREFIX="pr49-l2-snapshot-bisect-";
const ADMIN_DIAG_PREFIX="pr49-l2-admin-candidate-bisect-";
const ENTRY_DIAG_PREFIX="pr49-l2-wrapper-entry-bisect-";
const LIST_DIAG_PREFIX="pr49-l2-admin-list-bisect-";
const BUILD_DIAG_PREFIX="pr49-l2-admin-build-bisect-";
const UPLOAD_DIAG_PREFIX="pr49-l2-admin-upload-bisect-";
const TAG_PATTERN=/^[a-f0-9]{12}$/i;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanJson(text){
  const raw=String(text||"").replace(/\x1b\[[0-9;]*m/g,"").trim();
  const starts=[raw.indexOf("["),raw.indexOf("{")].filter(i=>i>=0).sort((a,b)=>a-b);
  if(!starts.length)throw new Error("WRANGLER_JSON_MISSING");
  return JSON.parse(raw.slice(starts[0]));
}
function childEnv(overrides={},stripCiOverride=false){
  const env={...process.env,CI:"1",...overrides};
  if(stripCiOverride)delete env.WRANGLER_CI_OVERRIDE_NAME;
  return env;
}
function run(command,args,cwd,{stdio="pipe",envOverrides={},stripCiOverride=false}={}){
  const r=spawnSync(command,args,{cwd,encoding:"utf8",env:childEnv(envOverrides,stripCiOverride),stdio,maxBuffer:4*1024*1024,timeout:90000,killSignal:"SIGKILL"});
  if(r.error||r.status!==0)throw Object.assign(new Error(`${command.toUpperCase()}_FAILED:${args.join(" ")}`),{stdout:r.stdout,stderr:r.stderr});
  return r;
}
function adminWrangler(args,cwd,options={}){
  return run("npx",["--yes",`wrangler@${WRANGLER}`,...args],cwd,{...options,envOverrides:{...(options.envOverrides||{}),WRANGLER_CI_OVERRIDE_NAME:ADMIN}});
}
function maintenanceWrangler(args,cwd,options={}){
  return run("npx",["--yes",`wrangler@${WRANGLER}`,...args],cwd,{...options,stripCiOverride:true});
}
function idOf(x){return String(x?.version_id||x?.versionId||x?.id||"").trim()}
function tagOf(x){return String(x?.tag||x?.annotations?.["workers/tag"]||"").trim()}
function rows(payload){return Array.isArray(payload)?payload:Array.isArray(payload?.versions)?payload.versions:Array.isArray(payload?.result)?payload.result:[]}
function candidateByTag(payload,tag){
  const ids=[...new Set(rows(payload).filter(x=>tagOf(x)===tag&&UUID_PATTERN.test(idOf(x))).map(idOf))];
  if(ids.length>1)throw new Error(`ADMIN_CANDIDATE_TAG_AMBIGUOUS:${tag}:${ids.length}`);
  return ids[0]||null;
}
function listAdmin(cwd){return cleanJson(adminWrangler(["versions","list","--name",ADMIN,"--json"],cwd).stdout)}
function ensureAdminCandidate(tag){
  const cwd=resolve(process.cwd(),"../admin");
  const existing=candidateByTag(listAdmin(cwd),tag);
  if(existing)return{version_id:existing,reused:true};
  run("npm",["run","cf:build"],cwd,{stdio:"inherit",stripCiOverride:true});
  adminWrangler(["versions","upload","--name",ADMIN,"--tag",tag,"--message",`L2 self-contained admin candidate ${tag}`],cwd,{stdio:"inherit"});
  const created=candidateByTag(listAdmin(cwd),tag);
  if(!created)throw new Error(`ADMIN_CANDIDATE_NOT_FOUND_AFTER_UPLOAD:${tag}`);
  return{version_id:created,reused:false};
}
function deploymentSummary(payload,label){
  const versions=Array.isArray(payload?.versions)?payload.versions:[];
  if(!versions.length)throw new Error(`${label}_DEPLOYMENT_VERSIONS_MISSING`);
  const normalized=versions.map(v=>({version_id:idOf(v),percentage:Number(v?.percentage)}));
  if(normalized.some(v=>!UUID_PATTERN.test(v.version_id)||!Number.isFinite(v.percentage)))throw new Error(`${label}_DEPLOYMENT_VERSION_INVALID`);
  const sum=normalized.reduce((total,v)=>total+v.percentage,0);
  if(Math.abs(sum-100)>0.001)throw new Error(`${label}_DEPLOYMENT_PERCENTAGE_INVALID:${sum}`);
  return normalized;
}
function snapshotBisect(tag){
  const request=JSON.parse(readFileSync(resolve(process.cwd(),"l2-acceptance-request.json"),"utf8"));
  const requestId=String(request?.request_id||"");
  if(!requestId.startsWith(DIAG_PREFIX))return false;
  const maintenancePayload=cleanJson(maintenanceWrangler(["versions","list","--name",MAINTENANCE,"--json"],process.cwd()).stdout);
  const maintenanceVersion=candidateByTag(maintenancePayload,tag);
  if(!maintenanceVersion)throw new Error(`MAINTENANCE_CANDIDATE_NOT_FOUND:${tag}`);
  const adminCwd=resolve(process.cwd(),"../admin");
  const adminDeployment=deploymentSummary(cleanJson(adminWrangler(["deployments","status","--name",ADMIN,"--json"],adminCwd).stdout),"ADMIN");
  const maintenanceDeployment=deploymentSummary(cleanJson(maintenanceWrangler(["deployments","status","--name",MAINTENANCE,"--json"],process.cwd()).stdout),"MAINTENANCE");
  console.log(JSON.stringify({event:"L2_SNAPSHOT_BISECT_PASS",tag,request_id:requestId,maintenance_version:maintenanceVersion,admin_deployment:adminDeployment,maintenance_deployment:maintenanceDeployment,secrets_redacted:true}));
  return true;
}
function main(){
  const tag=String(process.env.WORKERS_CI_COMMIT_SHA||"").slice(0,12);
  if(!TAG_PATTERN.test(tag))throw new Error("L2_TAG_INVALID");
  const request=JSON.parse(readFileSync(resolve(process.cwd(),"l2-acceptance-request.json"),"utf8"));
  const requestId=String(request?.request_id||"");
  if(requestId.startsWith(ENTRY_DIAG_PREFIX)){
    console.log(JSON.stringify({event:"L2_WRAPPER_ENTRY_BISECT_PASS",tag,request_id:requestId,secrets_redacted:true}));
    return;
  }
  if(requestId.startsWith(LIST_DIAG_PREFIX)){
    const adminCwd=resolve(process.cwd(),"../admin");
    const payload=listAdmin(adminCwd);
    const versions=rows(payload);
    const existing=candidateByTag(payload,tag);
    console.log(JSON.stringify({event:"L2_ADMIN_LIST_BISECT_PASS",tag,request_id:requestId,version_count:versions.length,exact_tag_present:Boolean(existing),exact_version:existing||null,secrets_redacted:true}));
    return;
  }
  if(requestId.startsWith(BUILD_DIAG_PREFIX)){
    const adminCwd=resolve(process.cwd(),"../admin");
    run("npm",["run","cf:build"],adminCwd,{stdio:"inherit",stripCiOverride:true});
    console.log(JSON.stringify({event:"L2_ADMIN_BUILD_BISECT_PASS",tag,request_id:requestId,secrets_redacted:true}));
    return;
  }
  if(requestId.startsWith(UPLOAD_DIAG_PREFIX)){
    const adminCwd=resolve(process.cwd(),"../admin");
    run("npx",["--yes",`wrangler@${WRANGLER}`,"versions","upload","--name",ADMIN,"--tag",tag,"--message",`L2 upload-only admin candidate no-ci-override ${tag}`],adminCwd,{stdio:"inherit",stripCiOverride:true});
    console.log(JSON.stringify({event:"L2_ADMIN_UPLOAD_BISECT_PASS",tag,request_id:requestId,ci_override_removed:true,secrets_redacted:true}));
    return;
  }
  const admin=ensureAdminCandidate(tag);
  console.log(JSON.stringify({event:"L2_SELF_CONTAINED_ADMIN_CANDIDATE_READY",tag,...admin,secrets_redacted:true}));
  if(requestId.startsWith(ADMIN_DIAG_PREFIX)){
    console.log(JSON.stringify({event:"L2_ADMIN_CANDIDATE_BISECT_PASS",tag,request_id:requestId,admin_version:admin.version_id,reused:admin.reused,secrets_redacted:true}));
    return;
  }
  if(snapshotBisect(tag))return;
  run(process.execPath,[resolve(process.cwd(),"scripts/run-l2-candidate-acceptance-core.mjs")],process.cwd(),{stdio:"inherit",stripCiOverride:true});
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href){try{main()}catch(error){console.error(JSON.stringify({event:"L2_SELF_CONTAINED_PREP_FAIL",error:String(error?.message||error),secrets_redacted:true}));process.exitCode=1}}
