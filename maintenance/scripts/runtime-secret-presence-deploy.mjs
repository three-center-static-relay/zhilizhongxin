#!/usr/bin/env node
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const SHA_PATTERN=/^[a-f0-9]{40,64}$/i;
const LEGACY_TOKEN_NAME="CLOUDFLARE_AI_GATEWAY_API_TOKEN";
const CANONICAL_TOKEN_NAME="CF_API_TOKEN";
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true,dynamic_route_mutation:false,expert_called:false})}\n`)}
function sleep(ms){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}
function run(command,args,{cwd=process.cwd(),env=process.env,stdio,encoding="utf8",maxBuffer=4*1024*1024}={}){const r=spawnSync(command,args,{cwd,env,stdio,encoding,maxBuffer});if(r.error)throw r.error;if(r.status!==0){const e=new Error(`${command.toUpperCase()}_FAILED`);e.exitCode=r.status||1;e.stdout=r.stdout;e.stderr=r.stderr;throw e}return r}
function packageWranglerVersion(){const p=JSON.parse(readFileSync(resolve(process.cwd(),"package.json"),"utf8")),v=String(p.devDependencies?.wrangler||"");if(!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v))throw new Error("EXACT_WRANGLER_VERSION_REQUIRED");return v}
function parseWorkersDevUrl(text){const m=String(text||"").match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i);if(!m)throw new Error("WORKERS_DEV_URL_NOT_FOUND");const u=new URL(m[0]);if(u.protocol!=="https:"||!u.hostname.endsWith(".workers.dev"))throw new Error("INVALID_WORKERS_DEV_URL");return `${u.protocol}//${u.host}`}
function classifyRemoteSecrets(version){
  const r=spawnSync("npx",["--yes",`wrangler@${version}`,"secret","list","--name","maintenance-worker","--format","json"],{cwd:process.cwd(),env:process.env,encoding:"utf8",maxBuffer:1024*1024});
  if(r.error||r.status!==0)return"secret_list_failed";
  try{
    const parsed=JSON.parse(String(r.stdout||"[]"));
    const rows=Array.isArray(parsed)?parsed:Array.isArray(parsed?.secrets)?parsed.secrets:[];
    const names=new Set(rows.map(x=>String(x?.name||"")).filter(Boolean));
    const legacy=names.has(LEGACY_TOKEN_NAME),canonical=names.has(CANONICAL_TOKEN_NAME);
    return legacy&&canonical?"both_present":legacy?"legacy_present":canonical?"canonical_present":"none_present";
  }catch{return"secret_list_failed"}
}
function deployDiagnostic(version,result){const r=run("npx",["--yes",`wrangler@${version}`,"deploy","--var",`MAINTENANCE_DIAGNOSTIC_RESULT:${result}`],{encoding:"utf8"});const output=`${r.stdout||""}\n${r.stderr||""}`,url=parseWorkersDevUrl(output);emit({ok:true,event:"MAINTENANCE_SECRET_NAME_DIAGNOSTIC_DEPLOYED",worker_host:new URL(url).host,result});return url}
function rollback(version){try{run("npx",["--yes",`wrangler@${version}`,"rollback","--message","Automatic rollback: maintenance Secret-name diagnostic complete"],{stdio:"inherit"});emit({ok:true,event:"MAINTENANCE_SECRET_NAME_DIAGNOSTIC_ROLLBACK_COMPLETE"});return true}catch{emit({ok:false,event:"MAINTENANCE_SECRET_NAME_DIAGNOSTIC_ROLLBACK_FAILED"},process.stderr);return false}}
function main(){
  const branch=String(process.env.WORKERS_CI_BRANCH||""),sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
  if(process.env.WORKERS_CI!=="1")throw new Error("WORKERS_CI_REQUIRED");
  if(branch!=="main")throw new Error("PRODUCTION_BRANCH_REQUIRED");
  if(!SHA_PATTERN.test(sha))throw new Error("VALID_COMMIT_SHA_REQUIRED");
  const repoRoot=run("git",["rev-parse","--show-toplevel"],{encoding:"utf8"}).stdout.trim(),sharedGate=resolve(repoRoot,"scripts/cloudflare-worker-gate.mjs"),version=packageWranglerVersion();
  emit({ok:true,event:"MAINTENANCE_SECRET_NAME_DIAGNOSTIC_START",commit_sha:sha,production_worker_traffic_changed:false});
  const baseline=spawnSync(process.execPath,[sharedGate,"maintenance","deploy"],{cwd:process.cwd(),env:process.env,stdio:"inherit"});
  if(baseline.error||baseline.status!==0){const e=new Error("BASELINE_MAINTENANCE_DEPLOY_FAILED");e.exitCode=baseline.status||1;throw e}
  const result=classifyRemoteSecrets(version);
  emit({ok:result!=="secret_list_failed",event:"MAINTENANCE_SECRET_NAMES_CLASSIFIED",result});
  const url=deployDiagnostic(version,result);
  emit({ok:true,event:"MAINTENANCE_SECRET_NAME_OBSERVATION_WINDOW",worker_host:new URL(url).host,result,window_ms:60000});
  sleep(60000);
  if(!rollback(version)){const e=new Error("DIAGNOSTIC_ROLLBACK_FAILED");e.exitCode=1;throw e}
  emit({ok:true,event:"MAINTENANCE_SECRET_NAME_DIAGNOSTIC_COMPLETE",commit_sha:sha,result,production_worker_traffic_changed:false});
}
const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invoked){try{main()}catch(error){emit({ok:false,event:"MAINTENANCE_SECRET_NAME_DIAGNOSTIC_FAIL",code:String(error?.message||error).replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,120)},process.stderr);process.exitCode=Number.isInteger(error?.exitCode)?error.exitCode:1}}
