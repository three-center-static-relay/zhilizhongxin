#!/usr/bin/env node
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const SHA_PATTERN=/^[a-f0-9]{40,64}$/i;
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
function safeCode(v){return String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,160)}
function run(command,args,{cwd=process.cwd(),env=process.env,stdio,encoding="utf8",maxBuffer=4*1024*1024}={}){const r=spawnSync(command,args,{cwd,env,stdio,encoding,maxBuffer});if(r.error)throw r.error;if(r.status!==0){const e=new Error(`${command.toUpperCase()}_FAILED`);e.exitCode=r.status||1;e.stdout=r.stdout;e.stderr=r.stderr;throw e}return r}
function parseWorkersDevUrl(text){const m=String(text||"").match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i);if(!m)throw new Error("WORKERS_DEV_URL_NOT_FOUND");const u=new URL(m[0]);if(u.protocol!=="https:"||!u.hostname.endsWith(".workers.dev"))throw new Error("INVALID_WORKERS_DEV_URL");return `${u.protocol}//${u.host}`}
function packageWranglerVersion(){const p=JSON.parse(readFileSync(resolve(process.cwd(),"package.json"),"utf8")),v=String(p.devDependencies?.wrangler||"");if(!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v))throw new Error("EXACT_WRANGLER_VERSION_REQUIRED");return v}
function rollback(version,message){try{run("npx",["--yes",`wrangler@${version}`,"rollback","--message",message],{stdio:"inherit"});emit({ok:true,event:"MAINTENANCE_AUTOMATIC_ROLLBACK_COMPLETE"},process.stderr);return true}catch{emit({ok:false,event:"MAINTENANCE_AUTOMATIC_ROLLBACK_FAILED"},process.stderr);return false}}
function deploy(version,runtimeProbe=null){const args=["--yes",`wrangler@${version}`,"deploy"];if(runtimeProbe)args.push("--var",`MAINTENANCE_RUNTIME_E2E_PROBE:${runtimeProbe}`);const r=run("npx",args,{encoding:"utf8"});const output=`${r.stdout||""}\n${r.stderr||""}`,url=parseWorkersDevUrl(output);emit({ok:true,event:runtimeProbe?"MAINTENANCE_E2E_CANDIDATE_DEPLOYED":"MAINTENANCE_CLEAN_DEPLOYED",worker_host:new URL(url).host,probe_persisted:Boolean(runtimeProbe),production_worker:"maintenance-worker"});return{url}}
function verify(repoRoot,url,probe){const r=spawnSync(process.execPath,[resolve(process.cwd(),"scripts/runtime-broker-postdeploy-e2e.mjs"),url],{cwd:process.cwd(),encoding:"utf8",env:{...process.env,MAINTENANCE_E2E_PROBE_TOKEN:probe},maxBuffer:4*1024*1024});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error)return{ok:false,code:"E2E_VERIFIER_SPAWN_ERROR"};if(r.status!==0){const m=`${r.stderr||""}\n${r.stdout||""}`.match(/MAINTENANCE_POSTDEPLOY_E2E_FAILED:([^\r\n]+)/);return{ok:false,code:safeCode(m?.[1]||`E2E_EXIT_${r.status??1}`)}}return{ok:true}}
function main(){
  const branch=String(process.env.WORKERS_CI_BRANCH||""),sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
  if(process.env.WORKERS_CI!=="1")throw new Error("WORKERS_CI_REQUIRED");
  if(branch!=="main")throw new Error("PRODUCTION_BRANCH_REQUIRED");
  if(!SHA_PATTERN.test(sha))throw new Error("VALID_COMMIT_SHA_REQUIRED");
  const repoRoot=run("git",["rev-parse","--show-toplevel"],{encoding:"utf8"}).stdout.trim(),sharedGate=resolve(repoRoot,"scripts/cloudflare-worker-gate.mjs"),version=packageWranglerVersion();
  emit({ok:true,event:"MAINTENANCE_RUNTIME_DEPLOY_GATE_START",commit_sha:sha,control_plane_owner:"admin-worker",credential_custodian:"maintenance-worker",cloudflare_credentials_local:true,dynamic_route_mutation:false});
  const baseline=spawnSync(process.execPath,[sharedGate,"maintenance","deploy"],{cwd:process.cwd(),env:process.env,stdio:"inherit"});
  if(baseline.error||baseline.status!==0){const e=new Error("BASELINE_MAINTENANCE_DEPLOY_FAILED");e.exitCode=baseline.status||1;throw e}
  const probe=randomBytes(32).toString("hex");
  let candidate;
  try{candidate=deploy(version,probe)}catch(error){rollback(version,"Automatic rollback: maintenance runtime candidate deploy failed");throw error}
  const checked=verify(repoRoot,candidate.url,probe);
  if(!checked.ok){rollback(version,"Automatic rollback: maintenance runtime AI Gateway credential-read selftest failed");const e=new Error(`MAINTENANCE_RUNTIME_E2E_FAILED:${checked.code}`);e.exitCode=1;throw e}
  emit({ok:true,event:"MAINTENANCE_RUNTIME_E2E_CANDIDATE_PASS",commit_sha:sha,worker_host:new URL(candidate.url).host,selftest:"maintenance-ai-gateway-credential-read-v1",probe_persisted:true,dynamic_route_mutation:false});
  try{const finalDeploy=deploy(version,null);emit({ok:true,event:"MAINTENANCE_RUNTIME_E2E_DEPLOY_GATE_PASS",commit_sha:sha,worker_host:new URL(finalDeploy.url).host,probe_persisted:false,production_attestation:true,control_plane_owner:"admin-worker",credential_custodian:"maintenance-worker",cloudflare_credentials_local:true,dynamic_route_mutation:false});}
  catch(error){rollback(version,"Automatic rollback: clean maintenance attestation deploy failed");throw error}
}
const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invoked){try{main()}catch(error){emit({ok:false,event:"MAINTENANCE_RUNTIME_DEPLOY_GATE_FAIL",code:safeCode(error?.message||error)},process.stderr);process.exitCode=Number.isInteger(error?.exitCode)?error.exitCode:1}}
