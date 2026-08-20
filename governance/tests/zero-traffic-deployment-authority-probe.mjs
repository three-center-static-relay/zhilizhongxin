// PR #153 fresh-branch observable trigger: runtime smoke semantics unchanged.
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler");
const worker="governance-worker";
const sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
assert.match(sha,/^[a-f0-9]{40,64}$/i,"VALID_COMMIT_SHA_REQUIRED");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function run(args,env=process.env){const r=spawnSync(wrangler,args,{cwd:process.cwd(),env,encoding:"utf8",maxBuffer:2*1024*1024});assert.equal(r.error,undefined,`WRANGLER_START_FAILED:${args[0]}`);return r}
function parseJson(text,label){try{return JSON.parse(text||"null")}catch{assert.fail(`${label}_JSON_INVALID`)}}
function idOf(x){return String(x?.version_id||x?.versionId||x?.id||"").trim()}
function pctOf(x){const n=Number(x?.percentage);return Number.isFinite(n)?n:null}
function versionSets(node,out=[]){if(!node||typeof node!=="object")return out;if(Array.isArray(node.versions)){const rows=node.versions.map(x=>({id:idOf(x),pct:pctOf(x)})).filter(x=>x.id&&x.pct!==null);if(rows.length===node.versions.length&&rows.length)out.push(rows)}for(const value of Object.values(node)){if(value&&typeof value==="object")versionSets(value,out)}return out}
function currentSet(){const r=run(["deployments","status","--name",worker,"--json"]);assert.equal(r.status,0,"DEPLOYMENT_STATUS_DENIED");const body=parseJson(r.stdout,"DEPLOYMENT_STATUS");const sets=versionSets(body).filter(rows=>Math.abs(rows.reduce((s,x)=>s+x.pct,0)-100)<0.001);assert.ok(sets.length>=1,"ACTIVE_DEPLOYMENT_NOT_FOUND");return sets[0]}
function singleActive(){const rows=currentSet();assert.equal(rows.length,1,"ACTIVE_DEPLOYMENT_MUST_BE_SINGLE_VERSION");assert.equal(rows[0].pct,100,"ACTIVE_VERSION_MUST_BE_100_PERCENT");return rows[0].id}
function uploadCandidate(){const dir=mkdtempSync(join(tmpdir(),"gov-zero-traffic-")),output=join(dir,"wrangler.ndjson"),tag=`gov-smoke-${sha.slice(0,12)}`;try{const env={...process.env,WRANGLER_OUTPUT_FILE_PATH:output};const r=run(["versions","upload","--name",worker,"--tag",tag,"--message","Zero-traffic governance runtime smoke candidate"],env);assert.equal(r.status,0,"VERSION_UPLOAD_FAILED");const lines=readFileSync(output,"utf8").split(/\r?\n/).filter(Boolean).map(line=>parseJson(line,"WRANGLER_OUTPUT"));const event=[...lines].reverse().find(x=>x?.type==="version-upload"&&String(x?.version_id||"").trim());assert.ok(event?.version_id,"UPLOADED_VERSION_ID_NOT_CAPTURED");return String(event.version_id)}finally{rmSync(dir,{recursive:true,force:true})}}
function deploySplit(candidate,active){return run(["versions","deploy",`${candidate}@0%`,`${active}@100%`,"--name",worker,"--message","Zero-traffic governance runtime smoke","-y"])}
function restore(active){return run(["versions","deploy",`${active}@100%`,"--name",worker,"--message","Restore after zero-traffic governance runtime smoke","-y"])}
async function smoke(candidate){
  const target="https://governance-worker.a15280020511.workers.dev/_internal/ai-gateway-control-readonly-probe";
  let last="NO_RESPONSE";
  for(let attempt=1;attempt<=6;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(target,{method:"GET",headers:{accept:"application/json","x-three-center-selftest":"1","Cloudflare-Workers-Version-Overrides":`${worker}="${candidate}"`},signal:controller.signal});
      const body=await response.json().catch(()=>null);
      const ok=response.status===200&&body?.ok===true&&body?.selftest==="governance-ai-gateway-control-readonly-v2"&&body?.service_binding===true&&body?.transport==="service-binding-fetch"&&body?.routes_readable===true&&body?.dynamic_route_mutation===false&&body?.expert_called===false&&body?.secrets_redacted===true;
      if(ok)return true;
      last=`HTTP_${response.status}:${String(body?.error_code||body?.error||"CONTRACT_MISMATCH").slice(0,80)}`;
    }catch(error){last=error?.name==="AbortError"?"TIMEOUT":"FETCH_FAILED"}finally{clearTimeout(timer)}
    await sleep(1500);
  }
  assert.fail(`GOVERNANCE_VERSION_OVERRIDE_SMOKE_FAILED:${last}`);
}

const active=singleActive();
const candidate=uploadCandidate();
assert.notEqual(candidate,active,"CANDIDATE_MUST_DIFFER_FROM_ACTIVE");
let staged=false,restoreAttempted=false;
try{
  const d=deploySplit(candidate,active);
  assert.equal(d.status,0,"ZERO_TRAFFIC_DEPLOYMENT_DENIED");
  staged=true;
  const rows=currentSet();
  const activeRow=rows.find(x=>x.id===active),candidateRow=rows.find(x=>x.id===candidate);
  assert.equal(activeRow?.pct,100,"ACTIVE_TRAFFIC_CHANGED");
  assert.equal(candidateRow?.pct,0,"CANDIDATE_NOT_ZERO_PERCENT");
  await smoke(candidate);
  console.log(JSON.stringify({ok:true,suite:"governance-zero-traffic-runtime-smoke",version_upload:true,deployment_write:true,version_override:true,candidate_runtime_ok:true,routes_readable:true,candidate_percentage:0,active_percentage:100,production_traffic_changed:false,dynamic_route_mutation:false,expert_called:false,secrets_redacted:true}));
} finally {
  if(staged){restoreAttempted=true;const r=restore(active);assert.equal(r.status,0,"ZERO_TRAFFIC_DEPLOYMENT_RESTORE_FAILED");const rows=currentSet();assert.equal(rows.length,1,"RESTORE_NOT_SINGLE_VERSION");assert.equal(rows[0].id,active,"RESTORE_ACTIVE_VERSION_MISMATCH");assert.equal(rows[0].pct,100,"RESTORE_ACTIVE_PERCENTAGE_MISMATCH")}
  if(staged&&restoreAttempted)console.log(JSON.stringify({ok:true,event:"ZERO_TRAFFIC_RUNTIME_SMOKE_RESTORED",single_active_version:true,active_percentage:100,production_traffic_changed:false,secrets_redacted:true}));
}
