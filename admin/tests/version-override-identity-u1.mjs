import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler"),worker="admin-worker";
const sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
assert.match(sha,/^[a-f0-9]{40,64}$/i,"VALID_COMMIT_SHA_REQUIRED");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function run(args,env=process.env){const r=spawnSync(wrangler,args,{cwd:process.cwd(),env,encoding:"utf8",maxBuffer:3*1024*1024});assert.equal(r.error,undefined,`WRANGLER_START_FAILED:${args[0]}`);return r}
function parseJson(text,label){try{return JSON.parse(text||"null")}catch{assert.fail(`${label}_JSON_INVALID`)}}
function sets(node,out=[]){if(!node||typeof node!=="object")return out;if(Array.isArray(node.versions)){const rows=node.versions.map(x=>({id:String(x?.version_id||x?.versionId||x?.id||""),pct:Number(x?.percentage)})).filter(x=>x.id&&Number.isFinite(x.pct));if(rows.length===node.versions.length&&rows.length)out.push(rows)}for(const v of Object.values(node))if(v&&typeof v==="object")sets(v,out);return out}
function currentSet(){const r=run(["deployments","status","--name",worker,"--json"]);assert.equal(r.status,0,"DEPLOYMENT_STATUS_FAILED");const rows=sets(parseJson(r.stdout,"DEPLOYMENT_STATUS")).find(x=>Math.abs(x.reduce((s,v)=>s+v.pct,0)-100)<.001);assert.ok(rows,"ACTIVE_DEPLOYMENT_NOT_FOUND");return rows}
function stable(){const rows=currentSet();assert.equal(rows.length,1,"ACTIVE_DEPLOYMENT_MUST_BE_SINGLE_VERSION");assert.equal(rows[0].pct,100,"ACTIVE_VERSION_MUST_BE_100");return rows[0].id}
function upload(){const d=mkdtempSync(join(tmpdir(),"admin-u1-")),out=join(d,"wrangler.ndjson");try{const r=run(["versions","upload","--name",worker,"--tag",`admin-u1-${sha.slice(0,12)}`,"--message","Admin 0% Version Override identity probe"],{...process.env,WRANGLER_OUTPUT_FILE_PATH:out});assert.equal(r.status,0,"VERSION_UPLOAD_FAILED");const lines=readFileSync(out,"utf8").split(/\r?\n/).filter(Boolean).map(x=>parseJson(x,"WRANGLER_OUTPUT"));const e=[...lines].reverse().find(x=>x?.type==="version-upload"&&x?.version_id);assert.ok(e?.version_id,"VERSION_ID_NOT_CAPTURED");return String(e.version_id)}finally{rmSync(d,{recursive:true,force:true})}}
function deploy(candidate,stableId){const r=run(["versions","deploy",`${candidate}@0%`,`${stableId}@100%`,"--name",worker,"--message","Admin U1 zero-traffic identity stage","-y"]);assert.equal(r.status,0,"ZERO_TRAFFIC_STAGE_FAILED")}
function restore(stableId){const r=run(["versions","deploy",`${stableId}@100%`,"--name",worker,"--message","Restore after admin U1 identity probe","-y"]);assert.equal(r.status,0,"RESTORE_FAILED");const rows=currentSet();assert.equal(rows.length,1,"RESTORE_NOT_SINGLE");assert.equal(rows[0].id,stableId,"RESTORE_VERSION_MISMATCH");assert.equal(rows[0].pct,100,"RESTORE_PERCENT_MISMATCH")}

const stableId=stable(),candidate=upload();assert.notEqual(candidate,stableId,"CANDIDATE_MUST_DIFFER");let staged=false;
try{
  deploy(candidate,stableId);staged=true;
  const rows=currentSet();assert.equal(rows.find(x=>x.id===stableId)?.pct,100,"STABLE_TRAFFIC_CHANGED");assert.equal(rows.find(x=>x.id===candidate)?.pct,0,"CANDIDATE_NOT_ZERO");
  let ok=false,last="NO_RESPONSE";
  for(let i=0;i<6;i++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),10000);
    try{const r=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/version-identity-probe",{headers:{"x-three-center-selftest":"1","Cloudflare-Workers-Version-Overrides":`admin-worker=\"${candidate}\"`},signal:c.signal});const b=await r.json().catch(()=>null);ok=r.status===200&&b?.ok===true&&b?.selftest==="admin-version-identity-v1"&&String(b?.version_id||"")===candidate&&b?.production_worker_traffic_changed===false&&b?.dynamic_route_mutation===false&&b?.expert_called===false&&b?.secrets_redacted===true;if(ok)break;last=`HTTP_${r.status}:${String(b?.selftest||b?.error||"MISMATCH")}`}catch(e){last=e?.name==="AbortError"?"TIMEOUT":"FETCH_FAILED"}finally{clearTimeout(t)}if(i<5)await sleep(1500)
  }
  assert.equal(ok,true,`ADMIN_VERSION_OVERRIDE_IDENTITY_FAILED:${last}`);
  console.log(JSON.stringify({ok:true,suite:"admin-version-override-identity-u1",candidate_percentage:0,stable_percentage:100,identity_matched:true,production_traffic_changed:false,dynamic_route_mutation:false,expert_called:false,secrets_redacted:true}));
} finally {if(staged){restore(stableId);console.log(JSON.stringify({ok:true,event:"ADMIN_U1_RESTORED",single_active_version:true,active_percentage:100,production_traffic_changed:false,secrets_redacted:true}))}}
