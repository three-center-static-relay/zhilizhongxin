import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler");
const name="governance-binding-probe-20260820";
const status=spawnSync(wrangler,["deployments","status","--name",name,"--json"],{
  cwd:process.cwd(),
  env:process.env,
  encoding:"utf8",
  maxBuffer:1024*1024
});
assert.equal(status.error,undefined,"TEMP_GOVERNANCE_PROBE_STATUS_START_FAILED");
assert.equal(status.status,0,"TEMP_GOVERNANCE_PROBE_NOT_PRESENT");
let parsed;
try{parsed=JSON.parse(status.stdout||"null")}catch{assert.fail("TEMP_GOVERNANCE_PROBE_STATUS_JSON_INVALID")}
assert.ok(parsed!==null,"TEMP_GOVERNANCE_PROBE_STATUS_REQUIRED");
console.log(JSON.stringify({ok:true,suite:"governance-temp-worker-residue-check",previous_temp_worker_present:true,previous_deploy_succeeded:true,previous_delete_suspected_failed:true,read_only:true,secrets_redacted:true}));
