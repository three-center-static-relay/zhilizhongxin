import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
assert.match(sha,/^[a-f0-9]{40,64}$/i,"VALID_COMMIT_SHA_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler"),worker="governance-worker";
function run(args,env=process.env){const r=spawnSync(wrangler,args,{cwd:process.cwd(),env,encoding:"utf8",maxBuffer:4*1024*1024});assert.equal(r.error,undefined,`WRANGLER_START_FAILED:${args[0]}`);return r}
function parseJson(text,label){try{return JSON.parse(text||"null")}catch{assert.fail(`${label}_JSON_INVALID`)}}
function idOf(x){return String(x?.version_id||x?.versionId||x?.id||"").trim()}
function pctOf(x){const n=Number(x?.percentage);return Number.isFinite(n)?n:null}
function versionSets(node,out=[]){if(!node||typeof node!=="object")return out;if(Array.isArray(node.versions)){const rows=node.versions.map(x=>({id:idOf(x),pct:pctOf(x)})).filter(x=>x.id&&x.pct!==null);if(rows.length===node.versions.length&&rows.length)out.push(rows)}for(const value of Object.values(node))if(value&&typeof value==="object")versionSets(value,out);return out}
const status=run(["deployments","status","--name",worker,"--json"]);assert.equal(status.status,0,"DEPLOYMENT_STATUS_DENIED");
const body=parseJson(status.stdout,"DEPLOYMENT_STATUS"),sets=versionSets(body).filter(rows=>Math.abs(rows.reduce((s,x)=>s+x.pct,0)-100)<0.001);assert.ok(sets.length>=1,"ACTIVE_DEPLOYMENT_NOT_FOUND");
const active=sets[0];assert.equal(active.length,1,"ACTIVE_DEPLOYMENT_NOT_SINGLE");assert.equal(active[0].pct,100,"ACTIVE_DEPLOYMENT_NOT_100");
const dir=mkdtempSync(join(tmpdir(),"gov-prod-stage-a-")),output=join(dir,"wrangler.ndjson");
try{
  const env={...process.env,WRANGLER_OUTPUT_FILE_PATH:output};
  const upload=run(["versions","upload","--config","wrangler.jsonc","--name",worker,"--keep-vars","--tag",`stage-a-${sha.slice(0,12)}`,"--message","Governance production stage A classifier"],env);
  assert.equal(upload.status,0,"VERSION_UPLOAD_KEEP_VARS_FAILED");
  const lines=readFileSync(output,"utf8").split(/\r?\n/).filter(Boolean).map(line=>parseJson(line,"WRANGLER_OUTPUT"));
  const event=[...lines].reverse().find(x=>x?.type==="version-upload"&&String(x?.version_id||"").trim());assert.ok(event?.version_id,"VERSION_UPLOAD_EVENT_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"governance-versioned-production-stage-a",active_single_100:true,version_upload_keep_vars:true,deployment_created:false,production_traffic_changed:false,version_id_exposed:false,secrets_redacted:true}));
}finally{rmSync(dir,{recursive:true,force:true})}
