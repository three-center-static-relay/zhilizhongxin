import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler");
const result=spawnSync(wrangler,["deployments","status","--name","governance-worker","--json"],{
  cwd:process.cwd(),env:process.env,encoding:"utf8",maxBuffer:1024*1024
});
assert.equal(result.error,undefined,"GOVERNANCE_DEPLOYMENT_STATUS_START_FAILED");
assert.equal(result.status,0,"GOVERNANCE_DEPLOYMENT_STATUS_READ_FAILED");
let payload;
try{payload=JSON.parse(result.stdout||"null")}catch{assert.fail("GOVERNANCE_DEPLOYMENT_STATUS_JSON_INVALID")}
const deployments=Array.isArray(payload)?payload:Array.isArray(payload?.deployments)?payload.deployments:Array.isArray(payload?.result)?payload.result:payload&&typeof payload==="object"?[payload]:[];
assert.ok(deployments.length>0,"GOVERNANCE_DEPLOYMENT_REQUIRED");
const d=deployments[0];
const raw=Array.isArray(d?.versions)?d.versions:Array.isArray(d?.deployment?.versions)?d.deployment.versions:[];
const rows=raw.map(v=>({id:String(v?.version_id||v?.versionId||v?.id||""),percentage:Number(v?.percentage)})).filter(v=>v.id);
if(rows.length===1&&!Number.isFinite(rows[0].percentage))rows[0].percentage=100;
assert.equal(rows.length,1,"GOVERNANCE_ACTIVE_DEPLOYMENT_NOT_SINGLE_VERSION");
assert.ok(Math.abs(rows[0].percentage-100)<0.001,"GOVERNANCE_ACTIVE_DEPLOYMENT_NOT_100_PERCENT");
console.log(JSON.stringify({ok:true,suite:"governance-current-deployment-shape",single_version:true,stable_100_percent:true,active_split:false,version_id_emitted:false,secrets_redacted:true}));
