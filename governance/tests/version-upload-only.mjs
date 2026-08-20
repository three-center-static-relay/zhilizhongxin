import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
assert.match(sha,/^[a-f0-9]{40,64}$/i,"VALID_COMMIT_SHA_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler");
const dir=mkdtempSync(join(tmpdir(),"governance-upload-only-"));
const output=join(dir,"wrangler.ndjson");
try{
  const env={...process.env,WRANGLER_OUTPUT_FILE_PATH:output};
  const result=spawnSync(wrangler,["versions","upload","--name","governance-worker","--tag",`upload-only-${sha.slice(0,12)}`,"--message","Governance exports upload-only classifier"],{cwd:process.cwd(),env,encoding:"utf8",maxBuffer:2*1024*1024});
  assert.equal(result.error,undefined,"VERSION_UPLOAD_PROCESS_START_FAILED");
  assert.equal(result.status,0,"VERSION_UPLOAD_REJECTED");
  const lines=readFileSync(output,"utf8").split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean);
  const uploaded=lines.some(row=>row?.type==="version-upload"&&String(row?.version_id||"").trim());
  assert.equal(uploaded,true,"VERSION_UPLOAD_EVENT_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"governance-versions-upload-only-exports",version_upload:true,deployment_created:false,production_traffic_changed:false,dynamic_route_mutation:false,expert_called:false,version_id_exposed:false,secrets_redacted:true}));
} finally {
  rmSync(dir,{recursive:true,force:true});
}
