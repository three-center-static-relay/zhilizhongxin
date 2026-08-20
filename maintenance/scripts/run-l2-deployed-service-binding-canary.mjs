#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER_VERSION="4.123.0";
const ACCOUNT_ID="e3aec027af13c557bbcb831d29c1e7b4";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
function deploymentEnv(env=process.env){const next={...env,CI:"1",NO_COLOR:"1",WRANGLER_SEND_METRICS:"false"};delete next.WRANGLER_CI_OVERRIDE_NAME;return next}
function runWrangler(args,{cwd,env,input}={}){return spawnSync("npx",["--yes",`wrangler@${WRANGLER_VERSION}`,...args],{cwd,env:env||deploymentEnv(),encoding:"utf8",input,maxBuffer:2*1024*1024})}
async function deleteDiagnostic(dir,name,env){for(let attempt=1;attempt<=2;attempt++){const r=runWrangler(["delete","--name",name,"--config","wrangler.jsonc"],{cwd:dir,env,input:"y\n"});if(!r.error&&r.status===0)return{ok:true,attempt};if(attempt<2)await sleep(1500)}return{ok:false}}

async function main(){
  const sha=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!/^[a-f0-9]{40,64}$/i.test(sha))throw new Error("VALID_COMMIT_SHA_REQUIRED");
  const name=`l2-admin-bind-${sha.slice(0,10).toLowerCase()}`,dir=mkdtempSync(join(tmpdir(),"l2-admin-bind-")),env=deploymentEnv();
  let deployed=false,cleanup={ok:true,skipped:true};
  try{
    writeFileSync(join(dir,"worker.mjs"),`export default{async fetch(){return Response.json({ok:true,diagnostic:true})}};\n`);
    writeFileSync(join(dir,"wrangler.jsonc"),JSON.stringify({name,main:"worker.mjs",account_id:ACCOUNT_ID,compatibility_date:"2026-08-20",workers_dev:true,preview_urls:false,observability:{enabled:false},services:[{binding:"ADMIN_DEFAULT",service:"admin-worker"}]},null,2));
    emit({event:"L2_DIAGNOSTIC_DEPLOY_START",phase:"deploy-with-admin-binding",commit_sha:sha,diagnostic_worker:name,diagnostic_worker_mutated:true,production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false,binding_execution:false,admin_named_entrypoint_bypassed:true,ai_gateway_bypassed:true});
    const deploy=runWrangler(["deploy","--config","wrangler.jsonc"],{cwd:dir,env});
    if(deploy.error||deploy.status!==0){emit({event:"L2_DIAGNOSTIC_DEPLOY_FAIL",phase:"deploy-with-admin-binding-failed",error_code:"DIAGNOSTIC_WORKER_DEPLOY_FAILED",exit_code:deploy.status??1,diagnostic_worker_mutated:false,production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false,binding_execution:false},process.stderr);process.exitCode=1;return}
    deployed=true;
    emit({event:"L2_DIAGNOSTIC_DEPLOY_PASS",phase:"deploy-with-admin-binding-pass",diagnostic_worker:name,diagnostic_worker_mutated:true,production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false,binding_execution:false,admin_named_entrypoint_bypassed:true,ai_gateway_bypassed:true});
  }finally{
    if(deployed)cleanup=await deleteDiagnostic(dir,name,env);
    emit({event:cleanup.ok?"L2_DIAGNOSTIC_WORKER_CLEANUP_PASS":"L2_DIAGNOSTIC_WORKER_CLEANUP_FAIL",phase:cleanup.ok?"diagnostic-cleanup-pass":"diagnostic-cleanup-failed",diagnostic_worker:name,cleanup_ok:cleanup.ok===true,cleanup_attempt:cleanup.attempt??null,production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false},cleanup.ok?process.stdout:process.stderr);
    rmSync(dir,{recursive:true,force:true});
    if(deployed&&!cleanup.ok)process.exitCode=1;
  }
}
const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invoked)main().catch(()=>{emit({event:"L2_DIAGNOSTIC_DEPLOY_FAIL",phase:"script-failed",error_code:"DIAGNOSTIC_SCRIPT_FAILED",production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false},process.stderr);process.exitCode=1});
