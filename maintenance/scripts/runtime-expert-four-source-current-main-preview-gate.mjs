#!/usr/bin/env node
import {spawnSync} from "node:child_process";
const safe=v=>String(v??"UNKNOWN").replace(/[^0-9A-Za-z_.:/=@+-]/g,"_").slice(0,240);
function emit(x,stream=process.stdout){stream.write(`${JSON.stringify({...x,secrets_redacted:true})}\n`)}
function run(command,args,{cwd=process.cwd(),env=process.env,stdio="inherit"}={}){const r=spawnSync(command,args,{cwd,env,encoding:"utf8",stdio,maxBuffer:12*1024*1024});if(r.error)throw r.error;if(r.status!==0){const e=new Error(`${command.toUpperCase()}_FAILED`);e.exitCode=r.status||1;throw e}return r}
async function main(){const branch=String(process.env.WORKERS_CI_BRANCH||""),sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");if(process.env.WORKERS_CI!=="1")throw new Error("WORKERS_CI_REQUIRED");if(!branch||branch==="main")throw new Error("PREVIEW_BRANCH_REQUIRED");emit({ok:true,event:"STATIC_GATE_ISOLATION_START",commit_sha:sha});run("npm",["run","cf:build"]);emit({ok:true,event:"STATIC_GATE_ISOLATION_PASS",commit_sha:sha,no_runtime_mutation:true})}
main().catch(error=>{emit({ok:false,event:"STATIC_GATE_ISOLATION_FAIL",code:safe(error?.message||error)},process.stderr);process.exitCode=Number.isInteger(error?.exitCode)?error.exitCode:1});
