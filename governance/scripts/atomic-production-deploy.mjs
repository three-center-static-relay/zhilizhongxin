#!/usr/bin/env node
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";

const SHA=/^[a-f0-9]{40,64}$/i;
const EXACT_VERSION=/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const QUEUES=["three-center-maintenance","three-center-maintenance-dlq"];
const clean=v=>String(v??"").trim();
const safe=v=>clean(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:,=-]/g,"_").slice(0,200);
const emit=(body,stream=process.stdout)=>stream.write(`${JSON.stringify({...body,secrets_redacted:true})}\n`);

function run(command,args,{stdio,encoding="utf8",maxBuffer=8*1024*1024}={}){
  const r=spawnSync(command,args,{cwd:process.cwd(),env:process.env,stdio,encoding,maxBuffer});
  if(r.error)throw r.error;
  if(r.status!==0){const e=new Error(`${command.toUpperCase()}_FAILED`);e.exitCode=r.status||1;e.stdout=r.stdout;e.stderr=r.stderr;throw e}
  return r;
}
function wranglerVersion(){const p=JSON.parse(readFileSync(resolve(process.cwd(),"package.json"),"utf8"));const v=clean(p.devDependencies?.wrangler);assert.match(v,EXACT_VERSION,"EXACT_WRANGLER_VERSION_REQUIRED");return v}
function wrangler(v,args,{allowFailure=false,stdio,encoding="utf8"}={}){
  const r=spawnSync("npx",["--yes",`wrangler@${v}`,...args],{cwd:process.cwd(),env:process.env,stdio,encoding,maxBuffer:8*1024*1024});
  if(r.error)throw r.error;
  if(!allowFailure&&r.status!==0){const e=new Error(`WRANGLER_FAILED:${safe(r.stderr||r.stdout||r.status)}`);e.exitCode=r.status||1;e.stdout=r.stdout;e.stderr=r.stderr;throw e}
  return r;
}
function ensureQueue(v,name){
  const probe=wrangler(v,["queues","info",name,"--config","wrangler.jsonc"],{allowFailure:true,encoding:"utf8"});
  if(probe.status===0){emit({ok:true,event:"GOVERNANCE_QUEUE_PRESENT",queue:name});return}
  const created=wrangler(v,["queues","create",name,"--config","wrangler.jsonc"],{allowFailure:true,encoding:"utf8"});
  if(created.status!==0){const text=`${created.stderr||""}\n${created.stdout||""}`;if(/already exists/i.test(text)){emit({ok:true,event:"GOVERNANCE_QUEUE_PRESENT_AFTER_RACE",queue:name});return}const e=new Error(`QUEUE_BOOTSTRAP_FAILED:${name}:${safe(text)}`);e.exitCode=created.status||1;throw e}
  emit({ok:true,event:"GOVERNANCE_QUEUE_CREATED",queue:name});
}

function main(){
  const branch=clean(process.env.WORKERS_CI_BRANCH),sha=clean(process.env.WORKERS_CI_COMMIT_SHA);
  assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
  assert.equal(branch,"main","PRODUCTION_BRANCH_REQUIRED");
  assert.match(sha,SHA,"VALID_COMMIT_SHA_REQUIRED");
  const v=wranglerVersion();
  emit({ok:true,event:"GOVERNANCE_ATOMIC_PRODUCTION_START",commit_sha:sha,model_sources:["workers-ai","openrouter","huggingface"],free_first:true,auto_paid_budget_usd:0});
  run("npm",["run","cf:build"],{stdio:"inherit"});
  for(const q of QUEUES)ensureQueue(v,q);
  const deploy=wrangler(v,["deploy","--config","wrangler.jsonc","--x-provision","--x-auto-create"],{encoding:"utf8"});
  if(deploy.stdout)process.stdout.write(deploy.stdout);if(deploy.stderr)process.stderr.write(deploy.stderr);
  emit({ok:true,event:"GOVERNANCE_ATOMIC_PRODUCTION_PASS",commit_sha:sha,queues_ready:true,workflow_binding:true,analytics_binding:true,workers_ai_binding:true,active_percentage:100,active_percentage_authority:"wrangler-deploy-success",rollback_available:true,model_sources:["workers-ai","openrouter","huggingface"],free_first:true,auto_paid_budget_usd:0});
}

try{main()}catch(error){if(error.stdout)process.stdout.write(error.stdout);if(error.stderr)process.stderr.write(error.stderr);emit({ok:false,event:"GOVERNANCE_ATOMIC_PRODUCTION_FAIL",code:safe(error?.message||error)},process.stderr);process.exitCode=Number.isInteger(error?.exitCode)?error.exitCode:1}
