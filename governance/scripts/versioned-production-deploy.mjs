#!/usr/bin/env node
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";

const WORKER="governance-worker";
const SHA=/^[a-f0-9]{40,64}$/i;
const EXACT_VERSION=/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const safe=v=>String(v??"UNKNOWN").replace(/[^0-9A-Za-z_.:,=-]/g,"_").slice(0,240);
const emit=(body,stream=process.stdout)=>stream.write(`${JSON.stringify({...body,secrets_redacted:true})}\n`);

function run(command,args,{cwd=process.cwd(),env=process.env,stdio,encoding="utf8",maxBuffer=8*1024*1024}={}){
  const r=spawnSync(command,args,{cwd,env,stdio,encoding,maxBuffer});
  if(r.error)throw r.error;
  if(r.status!==0){const e=new Error(`${command.toUpperCase()}_FAILED`);e.exitCode=r.status||1;e.stdout=r.stdout;e.stderr=r.stderr;throw e}
  return r;
}
function repositoryRoot(){return run("git",["rev-parse","--show-toplevel"]).stdout.trim()}
function gitObjectExists(root,object){const r=spawnSync("git",["cat-file","-e",object],{cwd:root,env:process.env,stdio:"ignore"});return !r.error&&r.status===0}
function fetchParentHistory(root,sha,branch,parent){
  for(const refspec of [`refs/heads/${branch}`,sha]){
    const r=spawnSync("git",["fetch","--no-tags","--depth=2","origin",refspec],{cwd:root,env:process.env,encoding:"utf8",maxBuffer:4*1024*1024});
    if(!r.error&&r.status===0&&gitObjectExists(root,`${parent}^{commit}`))return true;
  }
  return false;
}
function wranglerVersion(){
  const pkg=JSON.parse(readFileSync(resolve(process.cwd(),"package.json"),"utf8"));
  const v=String(pkg.devDependencies?.wrangler||"");
  assert.match(v,EXACT_VERSION,"EXACT_WRANGLER_VERSION_REQUIRED");
  return v;
}
function wrangler(v,args,options={}){return run("npx",["--yes",`wrangler@${v}`,...args],options)}
function parseJson(text,label){try{return JSON.parse(text||"null")}catch{throw new Error(`${label}_JSON_INVALID`)}}
function idOf(x){return String(x?.version_id||x?.versionId||x?.id||"").trim()}
function pctOf(x){const n=Number(x?.percentage);return Number.isFinite(n)?n:null}
function versionSets(node,out=[]){
  if(!node||typeof node!=="object")return out;
  if(Array.isArray(node.versions)){
    const rows=node.versions.map(x=>({id:idOf(x),pct:pctOf(x)})).filter(x=>x.id&&x.pct!==null);
    if(rows.length===node.versions.length&&rows.length)out.push(rows);
  }
  for(const value of Object.values(node))if(value&&typeof value==="object")versionSets(value,out);
  return out;
}
function currentSet(v){
  const r=wrangler(v,["deployments","status","--name",WORKER,"--json"]);
  const body=parseJson(r.stdout,"DEPLOYMENT_STATUS");
  const sets=versionSets(body).filter(rows=>Math.abs(rows.reduce((sum,x)=>sum+x.pct,0)-100)<0.001);
  if(!sets.length)throw new Error("ACTIVE_DEPLOYMENT_NOT_FOUND");
  return sets[0];
}
function singleActive(v){
  const rows=currentSet(v);
  if(rows.length!==1||rows[0].pct!==100)throw new Error("ACTIVE_DEPLOYMENT_MUST_BE_SINGLE_100");
  return rows[0].id;
}
function unchangedLifecycleConfig(sha,branch){
  const root=repositoryRoot();
  const head=run("git",["rev-parse","HEAD"],{cwd:root}).stdout.trim();
  if(head!==sha)throw new Error("HEAD_COMMIT_MISMATCH");
  const raw=run("git",["cat-file","-p",sha],{cwd:root}).stdout;
  const parent=raw.match(/^parent ([a-f0-9]{40,64})$/im)?.[1];
  if(!SHA.test(parent||""))throw new Error("PARENT_COMMIT_REQUIRED");
  let historyDeepened=false;
  if(!gitObjectExists(root,`${parent}^{commit}`))historyDeepened=fetchParentHistory(root,sha,branch,parent);
  if(!gitObjectExists(root,`${parent}^{commit}`))throw new Error("PARENT_COMMIT_UNAVAILABLE");
  const diff=run("git",["diff","--name-only",parent,sha,"--","governance/wrangler.jsonc"],{cwd:root}).stdout.trim();
  if(diff)throw new Error("WRANGLER_LIFECYCLE_CHANGE_REQUIRES_ATOMIC_DEPLOY");
  return {historyDeepened,parentAvailable:true};
}
function uploadCandidate(v,sha){
  const dir=mkdtempSync(join(tmpdir(),"governance-prod-upload-"));
  const output=join(dir,"wrangler.ndjson");
  try{
    const env={...process.env,WRANGLER_OUTPUT_FILE_PATH:output};
    const r=wrangler(v,["versions","upload","--config","wrangler.jsonc","--name",WORKER,"--keep-vars","--tag",`prod-${sha.slice(0,12)}`,"--message",`Governance production ${sha.slice(0,12)}`],{env});
    if(r.stdout)process.stdout.write(r.stdout);
    if(r.stderr)process.stderr.write(r.stderr);
    const lines=readFileSync(output,"utf8").split(/\r?\n/).filter(Boolean).map(line=>parseJson(line,"WRANGLER_OUTPUT"));
    const event=[...lines].reverse().find(x=>x?.type==="version-upload"&&String(x?.version_id||"").trim());
    if(!event?.version_id)throw new Error("UPLOADED_VERSION_ID_NOT_CAPTURED");
    return String(event.version_id);
  }finally{rmSync(dir,{recursive:true,force:true})}
}
function deploy100(v,versionId,message){
  const r=wrangler(v,["versions","deploy",`${versionId}@100%`,"--name",WORKER,"--message",message,"-y"]);
  if(r.stdout)process.stdout.write(r.stdout);
  if(r.stderr)process.stderr.write(r.stderr);
}
function verify100(v,versionId){
  const rows=currentSet(v);
  if(rows.length!==1||rows[0].id!==versionId||rows[0].pct!==100)throw new Error("PRODUCTION_VERSION_NOT_100_PERCENT");
}

function main(){
  const branch=String(process.env.WORKERS_CI_BRANCH||""),sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
  assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
  assert.equal(branch,"main","PRODUCTION_BRANCH_REQUIRED");
  assert.match(sha,SHA,"VALID_COMMIT_SHA_REQUIRED");
  const lifecycle=unchangedLifecycleConfig(sha,branch);
  const v=wranglerVersion();
  emit({ok:true,event:"GOVERNANCE_VERSIONED_PRODUCTION_START",commit_sha:sha,history_deepened:lifecycle.historyDeepened,parent_available:lifecycle.parentAvailable});
  run("npm",["run","cf:build"],{stdio:"inherit"});
  const previous=singleActive(v);
  const candidate=uploadCandidate(v,sha);
  if(candidate===previous)throw new Error("CANDIDATE_MUST_DIFFER_FROM_ACTIVE");
  let deploymentAttempted=false;
  try{
    deploymentAttempted=true;
    deploy100(v,candidate,`Governance production ${sha.slice(0,12)}`);
    verify100(v,candidate);
    emit({ok:true,event:"GOVERNANCE_VERSIONED_PRODUCTION_PASS",commit_sha:sha,version_upload:true,production_deployment:true,active_percentage:100,rollback_available:true});
  }catch(error){
    if(deploymentAttempted){
      try{deploy100(v,previous,`Automatic rollback after failed governance production ${sha.slice(0,12)}`);verify100(v,previous);emit({ok:true,event:"GOVERNANCE_VERSIONED_PRODUCTION_ROLLBACK_COMPLETE",commit_sha:sha},process.stderr)}
      catch(rollbackError){emit({ok:false,event:"GOVERNANCE_VERSIONED_PRODUCTION_ROLLBACK_FAILED",commit_sha:sha,code:safe(rollbackError?.message||rollbackError)},process.stderr);throw rollbackError}
    }
    throw error;
  }
}

try{main()}catch(error){emit({ok:false,event:"GOVERNANCE_VERSIONED_PRODUCTION_FAIL",code:safe(error?.message||error)},process.stderr);process.exitCode=Number.isInteger(error?.exitCode)?error.exitCode:1}
