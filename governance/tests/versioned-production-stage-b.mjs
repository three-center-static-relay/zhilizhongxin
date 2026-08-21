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
function currentSet(){const r=run(["deployments","status","--name",worker,"--json"]);assert.equal(r.status,0,"DEPLOYMENT_STATUS_DENIED");const body=parseJson(r.stdout,"DEPLOYMENT_STATUS");const sets=versionSets(body).filter(rows=>Math.abs(rows.reduce((s,x)=>s+x.pct,0)-100)<0.001);assert.ok(sets.length>=1,"ACTIVE_DEPLOYMENT_NOT_FOUND");return sets[0]}
const activeRows=currentSet();assert.equal(activeRows.length,1,"ACTIVE_DEPLOYMENT_NOT_SINGLE");assert.equal(activeRows[0].pct,100,"ACTIVE_DEPLOYMENT_NOT_100");const active=activeRows[0].id;
const dir=mkdtempSync(join(tmpdir(),"gov-prod-stage-b-")),output=join(dir,"wrangler.ndjson");let candidate="",staged=false;
try{
  const env={...process.env,WRANGLER_OUTPUT_FILE_PATH:output};
  const upload=run(["versions","upload","--config","wrangler.jsonc","--name",worker,"--keep-vars","--tag",`stage-b-${sha.slice(0,12)}`,"--message","Governance production stage B classifier"],env);
  assert.equal(upload.status,0,"VERSION_UPLOAD_KEEP_VARS_FAILED");
  const lines=readFileSync(output,"utf8").split(/\r?\n/).filter(Boolean).map(line=>parseJson(line,"WRANGLER_OUTPUT"));
  const event=[...lines].reverse().find(x=>x?.type==="version-upload"&&String(x?.version_id||"").trim());assert.ok(event?.version_id,"VERSION_UPLOAD_EVENT_REQUIRED");candidate=String(event.version_id);assert.notEqual(candidate,active,"CANDIDATE_MUST_DIFFER_FROM_ACTIVE");
  const deploy=run(["versions","deploy",`${candidate}@0%`,`${active}@100%`,"--name",worker,"--message","Governance production stage B zero-traffic classifier","-y"]);assert.equal(deploy.status,0,"ZERO_TRAFFIC_DEPLOYMENT_FAILED");staged=true;
  const stagedRows=currentSet(),a=stagedRows.find(x=>x.id===active),c=stagedRows.find(x=>x.id===candidate);assert.equal(a?.pct,100,"ACTIVE_TRAFFIC_CHANGED");assert.equal(c?.pct,0,"CANDIDATE_NOT_ZERO_PERCENT");
  console.log(JSON.stringify({ok:true,suite:"governance-versioned-production-stage-b",version_upload:true,zero_traffic_deployment:true,active_percentage:100,candidate_percentage:0,production_traffic_changed:false,version_id_exposed:false,secrets_redacted:true}));
}finally{
  if(staged){const restore=run(["versions","deploy",`${active}@100%`,"--name",worker,"--message","Restore after Governance production stage B classifier","-y"]);assert.equal(restore.status,0,"ZERO_TRAFFIC_RESTORE_FAILED");const restored=currentSet();assert.equal(restored.length,1,"RESTORE_NOT_SINGLE_VERSION");assert.equal(restored[0].id,active,"RESTORE_ACTIVE_VERSION_MISMATCH");assert.equal(restored[0].pct,100,"RESTORE_ACTIVE_PERCENTAGE_MISMATCH")}
  rmSync(dir,{recursive:true,force:true});
}
