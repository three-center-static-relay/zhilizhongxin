#!/usr/bin/env node
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const SHA=/^[a-f0-9]{40,64}$/i;
const safe=v=>String(v??"UNKNOWN").replace(/[^0-9A-Za-z_.:/=-]/g,"_").slice(0,240);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function emit(x,stream=process.stdout){stream.write(`${JSON.stringify({...x,secrets_redacted:true})}\n`)}
function run(command,args,{cwd=process.cwd(),env=process.env,encoding="utf8",stdio,maxBuffer=12*1024*1024}={}){const r=spawnSync(command,args,{cwd,env,encoding,stdio,maxBuffer});if(r.error)throw r.error;if(r.status!==0){const e=new Error(`${command.toUpperCase()}_FAILED`);e.exitCode=r.status||1;e.stdout=r.stdout;e.stderr=r.stderr;throw e}return r}
function version(){const p=JSON.parse(readFileSync(resolve(process.cwd(),"package.json"),"utf8")),v=String(p.devDependencies?.wrangler||"");if(!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v))throw new Error("EXACT_WRANGLER_VERSION_REQUIRED");return v}
function parseUrl(text){const m=String(text||"").match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i);if(!m)throw new Error("WORKERS_DEV_URL_NOT_FOUND");return m[0].replace(/\/$/,"")}
function restore(v){const r=spawnSync("npx",["--yes",`wrangler@${v}`,"deploy","--config","wrangler.jsonc","--keep-vars"],{cwd:process.cwd(),env:process.env,encoding:"utf8",stdio:"inherit",maxBuffer:12*1024*1024});if(r.error||r.status!==0){const e=new Error("CLEAN_MAINTENANCE_RESTORE_FAILED");e.exitCode=r.status||1;throw e}}
async function probe(url,token){let last=null;for(let attempt=1;attempt<=2;attempt++){if(attempt>1)await sleep(1500);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);try{const response=await fetch(`${url}/v1/maintenance/neon-e2e`,{headers:{accept:"application/json","x-neon-e2e-probe":token},signal:controller.signal});const body=await response.json().catch(()=>null);last={status:response.status,body};if(response.status===200&&body?.ok===true)return{response,body,attempt}}catch(error){last={status:0,body:{error:error?.name==="AbortError"?"TIMEOUT":String(error?.message||error)}}}finally{clearTimeout(timer)}}const e=new Error(`NEON_E2E_FAILED:${safe(last?.body?.error||last?.body?.selftest||`HTTP_${last?.status||0}`)}`);e.exitCode=1;throw e}

async function main(){
  const branch=String(process.env.WORKERS_CI_BRANCH||""),sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
  if(process.env.WORKERS_CI!=="1")throw new Error("WORKERS_CI_REQUIRED");
  if(!branch||branch==="main")throw new Error("PREVIEW_BRANCH_REQUIRED");
  if(!SHA.test(sha))throw new Error("VALID_COMMIT_SHA_REQUIRED");
  const v=version(),token=randomBytes(32).toString("hex");
  emit({ok:true,event:"NEON_MEMORY_E2E_START",commit_sha:sha});
  run(process.execPath,[resolve("src/neon-memory-e2e-probe-index.js")],{stdio:"ignore"});
  run("npm",["run","cf:build"],{stdio:"inherit"});
  let primary=null;
  try{
    const d=run("npx",["--yes",`wrangler@${v}`,"deploy","--config","wrangler.neon-e2e-probe.jsonc","--keep-vars","--var",`NEON_E2E_PROBE:${token}`],{encoding:"utf8"});
    if(d.stdout)process.stdout.write(d.stdout);if(d.stderr)process.stderr.write(d.stderr);
    const url=parseUrl(`${d.stdout||""}\n${d.stderr||""}`);
    await sleep(1250);
    const {response,body,attempt}=await probe(url,token);
    const strict=body?.configured===true&&body?.connection_ok===true&&body?.bootstrap_ok===true&&body?.write_ok===true&&body?.readback_ok===true&&body?.digest_match===true&&body?.cleanup_ok===true&&Number(body?.records_left||0)===0&&body?.secret_exposed===false&&body?.secrets_redacted===true;
    if(!strict)throw Object.assign(new Error("NEON_E2E_RECEIPT_INVALID"),{exitCode:1});
    emit({ok:true,event:"NEON_MEMORY_E2E_RECEIPT",attempt,http_status:response.status,selftest:body.selftest,provider:body.provider,schema:body.schema,configured:true,connection_ok:true,bootstrap_ok:true,write_ok:true,readback_ok:true,digest_match:true,cleanup_ok:true,records_left:0,secret_exposed:false,production_mutation:false});
  }catch(e){primary=e}
  let restoreError=null;
  try{restore(v)}catch(e){restoreError=e}
  if(primary)throw primary;
  if(restoreError)throw restoreError;
  emit({ok:true,event:"NEON_MEMORY_E2E_PASS",commit_sha:sha,maintenance_restored:true});
}

const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invoked)main().catch(error=>{emit({ok:false,event:"NEON_MEMORY_E2E_FAIL",code:safe(error?.message||error)},process.stderr);process.exitCode=Number.isInteger(error?.exitCode)?error.exitCode:1});
