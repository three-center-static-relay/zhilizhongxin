#!/usr/bin/env node
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const SHA_PATTERN=/^[a-f0-9]{40,64}$/i;
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
function safeCode(v){return String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,180)}
function run(command,args,{cwd=process.cwd(),env=process.env,stdio,encoding="utf8",maxBuffer=8*1024*1024}={}){const r=spawnSync(command,args,{cwd,env,stdio,encoding,maxBuffer});if(r.error)throw r.error;if(r.status!==0){const e=new Error(`${command.toUpperCase()}_FAILED`);e.exitCode=r.status||1;throw e}return r}
function parseWorkersDevUrl(text){const m=String(text||"").match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i);if(!m)throw new Error("WORKERS_DEV_URL_NOT_FOUND");const u=new URL(m[0]);if(u.protocol!=="https:"||!u.hostname.endsWith(".workers.dev"))throw new Error("INVALID_WORKERS_DEV_URL");return`${u.protocol}//${u.host}`}
function packageWranglerVersion(){const p=JSON.parse(readFileSync(resolve(process.cwd(),"package.json"),"utf8")),v=String(p.devDependencies?.wrangler||"");if(!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v))throw new Error("EXACT_WRANGLER_VERSION_REQUIRED");return v}
function deployCandidate(version,probe){const args=["--yes",`wrangler@${version}`,"deploy","--var",`MAINTENANCE_RUNTIME_E2E_PROBE:${probe}`,"--var","MAINTENANCE_MODEL_UNIVERSE_PROBE:1"];const r=run("npx",args,{encoding:"utf8"}),output=`${r.stdout||""}\n${r.stderr||""}`,url=parseWorkersDevUrl(output);emit({ok:true,event:"MAINTENANCE_CANDIDATE_DEPLOY_STAGE_PASS",worker_host:new URL(url).host,probe_persisted:true,model_universe_probe_enabled:true,route_automation_enabled:false,production_dynamic_route_mutation:false,model_invocation:false});return{url}}
function main(){
  const branch=String(process.env.WORKERS_CI_BRANCH||""),sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
  if(process.env.WORKERS_CI!=="1")throw new Error("WORKERS_CI_REQUIRED");
  if(branch!=="main")throw new Error("PRODUCTION_BRANCH_REQUIRED");
  if(!SHA_PATTERN.test(sha))throw new Error("VALID_COMMIT_SHA_REQUIRED");
  const repoRoot=run("git",["rev-parse","--show-toplevel"],{encoding:"utf8"}).stdout.trim(),sharedGate=resolve(repoRoot,"scripts/cloudflare-worker-gate.mjs"),version=packageWranglerVersion();
  emit({ok:true,event:"MAINTENANCE_CANDIDATE_DEPLOY_STAGE_START",commit_sha:sha,policy_owner:"admin-worker",route_execution_owner:"maintenance-worker",credential_custodian:"maintenance-worker",cloudflare_credentials_local:true,model_id_pinning:false,future_models_auto_discover:true,model_source_classes:["workers-ai","openrouter","deepseek","huggingface"],route_automation_enabled:false,production_dynamic_route_mutation:false,model_invocation:false});
  const baseline=spawnSync(process.execPath,[sharedGate,"maintenance","deploy"],{cwd:process.cwd(),env:process.env,stdio:"inherit"});
  if(baseline.error||baseline.status!==0){const e=new Error("BASELINE_MAINTENANCE_DEPLOY_FAILED");e.exitCode=baseline.status||1;throw e}
  const probe=randomBytes(32).toString("hex");
  try{deployCandidate(version,probe)}catch(error){throw error}
  const restore=spawnSync(process.execPath,[sharedGate,"maintenance","deploy"],{cwd:process.cwd(),env:process.env,stdio:"inherit"});
  if(restore.error||restore.status!==0){const e=new Error("CLEAN_RESTORE_AFTER_CANDIDATE_FAILED");e.exitCode=restore.status||1;throw e}
  emit({ok:true,event:"MAINTENANCE_CANDIDATE_DEPLOY_STAGE_COMPLETE",commit_sha:sha,probe_persisted:false,model_universe_probe_persisted:false,production_attestation:true,policy_owner:"admin-worker",route_execution_owner:"maintenance-worker",credential_custodian:"maintenance-worker",model_id_pinning:false,future_models_auto_discover:true,route_automation_enabled:false,production_dynamic_route_mutation:false,model_invocation:false});
}
const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invoked){try{main()}catch(error){emit({ok:false,event:"MAINTENANCE_CANDIDATE_DEPLOY_STAGE_FAIL",code:safeCode(error?.message||error)},process.stderr);process.exitCode=Number.isInteger(error?.exitCode)?error.exitCode:1}}
