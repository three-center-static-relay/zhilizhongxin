#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const SHA_PATTERN=/^[a-f0-9]{40,64}$/i;
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
function safeCode(v){return String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,180)}
function main(){
  const branch=String(process.env.WORKERS_CI_BRANCH||""),sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
  if(process.env.WORKERS_CI!=="1")throw new Error("WORKERS_CI_REQUIRED");
  if(branch!=="main")throw new Error("PRODUCTION_BRANCH_REQUIRED");
  if(!SHA_PATTERN.test(sha))throw new Error("VALID_COMMIT_SHA_REQUIRED");
  const repoRoot=spawnSync("git",["rev-parse","--show-toplevel"],{encoding:"utf8"}).stdout.trim();
  const sharedGate=resolve(repoRoot,"scripts/cloudflare-worker-gate.mjs");
  emit({ok:true,event:"MAINTENANCE_BASELINE_ONLY_GATE_START",commit_sha:sha,policy_owner:"admin-worker",route_execution_owner:"maintenance-worker",credential_custodian:"maintenance-worker",cloudflare_credentials_local:true,model_id_pinning:false,future_models_auto_discover:true,model_source_classes:["workers-ai","openrouter","deepseek","huggingface"],route_automation_enabled:false,production_dynamic_route_mutation:false,model_invocation:false});
  const baseline=spawnSync(process.execPath,[sharedGate,"maintenance","deploy"],{cwd:process.cwd(),env:process.env,stdio:"inherit"});
  if(baseline.error||baseline.status!==0){const e=new Error("BASELINE_MAINTENANCE_DEPLOY_FAILED");e.exitCode=baseline.status||1;throw e}
  emit({ok:true,event:"MAINTENANCE_BASELINE_ONLY_GATE_PASS",commit_sha:sha,production_attestation:true,policy_owner:"admin-worker",route_execution_owner:"maintenance-worker",credential_custodian:"maintenance-worker",model_id_pinning:false,future_models_auto_discover:true,route_automation_enabled:false,production_dynamic_route_mutation:false,model_invocation:false});
}
const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invoked){try{main()}catch(error){emit({ok:false,event:"MAINTENANCE_BASELINE_ONLY_GATE_FAIL",code:safeCode(error?.message||error)},process.stderr);process.exitCode=Number.isInteger(error?.exitCode)?error.exitCode:1}}
