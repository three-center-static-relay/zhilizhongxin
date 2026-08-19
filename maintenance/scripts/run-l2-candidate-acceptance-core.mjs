#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const COMMIT_PATTERN=/^[a-f0-9]{40}$/i;
const TAG_PATTERN=/^[a-f0-9]{12}$/i;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRANGLER_TIMEOUT_MS=120000;
const PREVIEW_READY_TIMEOUT_MS=60000;
let phase="boot";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function mark(next,details={}){
  phase=next;
  console.log(JSON.stringify({event:"L2_STATELESS_PREVIEW_PROBE_PHASE",phase,at:new Date().toISOString(),...details,secrets_redacted:true}));
}
function run(args,{cwd=process.cwd(),env={}}={}){
  const result=spawnSync("npx",["--yes",`wrangler@${WRANGLER}`,...args],{
    cwd,encoding:"utf8",env:{...process.env,CI:"1",...env},maxBuffer:8*1024*1024,timeout:WRANGLER_TIMEOUT_MS,killSignal:"SIGTERM"
  });
  if(result.error?.code==="ETIMEDOUT")throw Object.assign(new Error(`WRANGLER_TIMEOUT:${args.join(" ")}`),{stdout:result.stdout,stderr:result.stderr});
  if(result.error||result.status!==0)throw Object.assign(new Error(`WRANGLER_FAILED:${args.join(" ")}`),{stdout:result.stdout,stderr:result.stderr});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  return result;
}
export function parseVersionUploadOutput(text){
  const rows=String(text||"").split(/\r?\n/).map(line=>line.trim()).filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});
  const row=[...rows].reverse().find(value=>value?.type==="version-upload");
  if(!row)throw new Error("VERSION_UPLOAD_STRUCTURED_OUTPUT_MISSING");
  const versionId=String(row.version_id||"").trim();
  const previewUrl=String(row.preview_url||row.preview_alias_url||"").trim();
  if(!UUID_PATTERN.test(versionId))throw new Error("STATELESS_PREVIEW_VERSION_ID_INVALID");
  if(!/^https:\/\/[A-Za-z0-9.-]+\.workers\.dev\/?$/.test(previewUrl))throw new Error("STATELESS_PREVIEW_URL_INVALID");
  return{versionId,previewUrl};
}
async function fetchPreview(previewUrl,commit,versionId){
  const deadline=Date.now()+PREVIEW_READY_TIMEOUT_MS;let last=null;
  while(Date.now()<deadline){
    try{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
      let response;
      try{response=await fetch(new URL("/health",previewUrl),{headers:{accept:"application/json"},signal:controller.signal})}
      finally{clearTimeout(timer)}
      const body=await response.json().catch(()=>null);
      if(response.ok&&body?.ok===true&&body?.commit_sha===commit&&body?.version_id===versionId)return body;
      last=new Error(`PREVIEW_RESPONSE_MISMATCH:${response.status}`);
    }catch(error){last=error}
    await sleep(2000);
  }
  throw last||new Error("STATELESS_PREVIEW_NOT_READY");
}
function config(name,main,commit){return{
  name,main,compatibility_date:"2026-08-18",compatibility_flags:["nodejs_compat"],
  workers_dev:false,preview_urls:true,version_metadata:{binding:"CF_VERSION_METADATA"},vars:{L2_COMMIT_SHA:commit}
}}

async function main(){
  mark("trigger-read");
  const request=JSON.parse(readFileSync("l2-acceptance-request.json","utf8"));
  if(request?.schema!=="expert-l2-acceptance-v1"||request?.enabled!==true)throw new Error("L2_TRIGGER_INVALID");
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!COMMIT_PATTERN.test(commit))throw new Error("L2_COMMIT_SHA_INVALID");
  const tag=commit.slice(0,12);
  if(!TAG_PATTERN.test(tag))throw new Error("L2_TAG_INVALID");

  const workerName=`l2-admin-preview-${tag}`;
  const dir=resolve(".l2-stateless-preview");
  const outputPath=resolve(dir,"wrangler-output.ndjson");
  const scaffoldConfig=resolve(dir,"wrangler.scaffold.jsonc");
  const candidateConfig=resolve(dir,"wrangler.candidate.jsonc");
  rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"scaffold.mjs"),`export default{fetch(){return new Response("not found",{status:404})}};\n`);
  writeFileSync(resolve(dir,"candidate.mjs"),`export default{fetch(request,env){const u=new URL(request.url);if(request.method!=="GET"||u.pathname!=="/health")return new Response("not found",{status:404});return Response.json({ok:true,commit_sha:env.L2_COMMIT_SHA,version_id:env.CF_VERSION_METADATA?.id||null,stateless:true})}};\n`);
  writeFileSync(scaffoldConfig,JSON.stringify(config(workerName,"scaffold.mjs",commit),null,2));
  writeFileSync(candidateConfig,JSON.stringify(config(workerName,"candidate.mjs",commit),null,2));

  let workerCreated=false;let primaryError=null;let receipt=null;
  try{
    mark("scaffold-deploy-begin",{worker:workerName,workers_dev:false,preview_urls:true,no_routes:true,stateless:true});
    run(["deploy","--config",scaffoldConfig],{cwd:dir});
    workerCreated=true;
    mark("scaffold-deploy-complete",{worker:workerName,production_route:false,workers_dev:false});

    mark("candidate-version-upload-begin",{worker:workerName,candidate_tag:tag,stateless:true,preview_urls:true});
    rmSync(outputPath,{force:true});
    run(["versions","upload","--tag",tag,"--preview-alias",`p-${tag}`,"--config",candidateConfig],{cwd:dir,env:{WRANGLER_OUTPUT_FILE_PATH:outputPath}});
    const parsed=parseVersionUploadOutput(readFileSync(outputPath,"utf8"));
    mark("candidate-version-upload-complete",{worker:workerName,version_id:parsed.versionId,preview_url_present:true});
    const body=await fetchPreview(parsed.previewUrl,commit,parsed.versionId);
    mark("preview-http-verified",{worker:workerName,version_id:parsed.versionId,http_ok:true});
    receipt={worker_name:workerName,version_id:parsed.versionId,preview_url_verified:true,commit_sha:body.commit_sha};
  }catch(error){primaryError=error}

  const cleanupErrors=[];
  if(workerCreated){
    try{
      mark("cleanup-delete-begin",{worker:workerName});
      run(["delete","--name",workerName],{cwd:dir});
      mark("cleanup-delete-complete",{worker:workerName});
    }catch(error){cleanupErrors.push(String(error?.message||error))}
  }
  rmSync(dir,{recursive:true,force:true});
  if(primaryError)throw Object.assign(primaryError,{cleanup_errors:cleanupErrors});
  if(cleanupErrors.length)throw Object.assign(new Error("STATELESS_PREVIEW_CLEANUP_FAILED"),{cleanup_errors:cleanupErrors});

  console.log(JSON.stringify({event:"L2_STATELESS_VERSION_PREVIEW_PROBE_PASS",ok:true,...receipt,scaffold_first_deployment:true,scaffold_workers_dev:false,scaffold_routes:false,stateless_worker:true,durable_object_implemented:false,preview_url:true,existing_production_workers_mutated:false,existing_production_traffic_changed:false,temporary_worker_deleted:true,secret_used:false,ai_gateway_called:false,dynamic_routes_mutated:false,secrets_redacted:true}));
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main().catch(error=>{
  console.error(JSON.stringify({event:"L2_STATELESS_VERSION_PREVIEW_PROBE_FAIL",phase,error:String(error?.message||error),cleanup_errors:error?.cleanup_errors||[],secrets_redacted:true}));
  process.exitCode=1;
});