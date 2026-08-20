#!/usr/bin/env node
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const SHA=/^[a-f0-9]{40,64}$/i,WORKER="maintenance-complex-e2e-20260821";
const safe=v=>String(v??"UNKNOWN").replace(/[^0-9A-Za-z_.:/=-]/g,"_").slice(0,220);
function emit(x,stream=process.stdout){stream.write(`${JSON.stringify({...x,secrets_redacted:true})}\n`)}
function run(command,args,{cwd=process.cwd(),env=process.env,encoding="utf8",stdio,maxBuffer=8*1024*1024,input}={}){const r=spawnSync(command,args,{cwd,env,encoding,stdio,maxBuffer,input});if(r.error)throw r.error;if(r.status!==0){const e=new Error(`${command.toUpperCase()}_FAILED`);e.exitCode=r.status||1;e.stdout=r.stdout;e.stderr=r.stderr;throw e}return r}
function parseUrl(text){const m=String(text||"").match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i);if(!m)throw new Error("WORKERS_DEV_URL_NOT_FOUND");return m[0].replace(/\/$/,"")}
function version(){const p=JSON.parse(readFileSync(resolve(process.cwd(),"package.json"),"utf8")),v=String(p.devDependencies?.wrangler||"");if(!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v))throw new Error("EXACT_WRANGLER_VERSION_REQUIRED");return v}
function cleanup(v){const r=spawnSync("npx",["--yes",`wrangler@${v}`,"delete","--name",WORKER,"--config","wrangler.complex-e2e.jsonc"],{cwd:process.cwd(),env:process.env,encoding:"utf8",input:"y\n",maxBuffer:4*1024*1024});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error||r.status!==0)throw new Error("COMPLEX_E2E_CLEANUP_FAILED");emit({ok:true,event:"LANGGRAPH_COMPLEX_E2E_TEMP_WORKER_DELETED",worker:WORKER})}

function main(){
  const branch=String(process.env.WORKERS_CI_BRANCH||""),sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");if(process.env.WORKERS_CI!=="1")throw new Error("WORKERS_CI_REQUIRED");if(!branch||branch==="main")throw new Error("PREVIEW_BRANCH_REQUIRED");if(!SHA.test(sha))throw new Error("VALID_COMMIT_SHA_REQUIRED");
  const v=version(),probe=randomBytes(32).toString("hex");emit({ok:true,event:"LANGGRAPH_COMPLEX_THREE_CENTER_STAGE_START",branch,commit_sha:sha,temporary_worker:WORKER,real_intelligence_task:true,real_compute_workflow:true,real_expert_multimodel_task:true,ai_gateway_dynamic_route_required:true});
  run("npm",["run","cf:build"],{stdio:"inherit"});
  let deployed=false,primary=null;
  try{
    const d=run("npx",["--yes",`wrangler@${v}`,"deploy","--config","wrangler.complex-e2e.jsonc","--var",`MAINTENANCE_RUNTIME_E2E_PROBE:${probe}","--var","MAINTENANCE_COMPLEX_E2E_PROBE:1"],{encoding:"utf8"});if(d.stdout)process.stdout.write(d.stdout);if(d.stderr)process.stderr.write(d.stderr);const url=parseUrl(`${d.stdout||""}\n${d.stderr||""}`);deployed=true;emit({ok:true,event:"LANGGRAPH_COMPLEX_E2E_TEMP_WORKER_DEPLOYED",worker_host:new URL(url).host});
    const verify=spawnSync(process.execPath,[resolve(process.cwd(),"scripts/runtime-complex-system-e2e.mjs"),url],{cwd:process.cwd(),encoding:"utf8",env:{...process.env,MAINTENANCE_E2E_PROBE_TOKEN:probe},maxBuffer:12*1024*1024});if(verify.stdout)process.stdout.write(verify.stdout);if(verify.stderr)process.stderr.write(verify.stderr);if(verify.error)throw verify.error;if(verify.status!==0){const m=`${verify.stderr||""}\n${verify.stdout||""}`.match(/LANGGRAPH_COMPLEX_THREE_CENTER_E2E_FAILED:([^\r\n]+)/);const e=new Error(`COMPLEX_E2E_FAILED:${safe(m?.[1]||`EXIT_${verify.status??1}`)}`);e.exitCode=verify.status||1;throw e}
  }catch(error){primary=error}
  let cleanupError=null;if(deployed){try{cleanup(v)}catch(error){cleanupError=error}}
  if(primary)throw primary;if(cleanupError)throw cleanupError;emit({ok:true,event:"LANGGRAPH_COMPLEX_THREE_CENTER_STAGE_COMPLETE",commit_sha:sha,temporary_worker_deleted:true,production_workers_mutated:false});
}

const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";if(import.meta.url===invoked){try{main()}catch(error){emit({ok:false,event:"LANGGRAPH_COMPLEX_THREE_CENTER_STAGE_FAIL",code:safe(error?.message||error)},process.stderr);process.exitCode=Number.isInteger(error?.exitCode)?error.exitCode:1}}
