import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler");
const name="admin-authority-probe-20260820";
const status=spawnSync(wrangler,["deployments","status","--name",name,"--json"],{cwd:process.cwd(),env:process.env,encoding:"utf8",maxBuffer:1024*1024});
assert.equal(status.error,undefined,"TEMP_ADMIN_STATUS_START_FAILED");
assert.equal(status.status,0,"TEMP_ADMIN_WORKER_NOT_OBSERVABLE");
let parsed;
try{parsed=JSON.parse(status.stdout||"null")}catch{assert.fail("TEMP_ADMIN_STATUS_JSON_INVALID")}
assert.ok(parsed!==null,"TEMP_ADMIN_STATUS_REQUIRED");
console.log(JSON.stringify({ok:true,suite:"admin-temp-worker-residue-readonly",temporary_worker_observable:true,read_only:true,production_worker_mutated:false,production_traffic_changed:false,dynamic_route_mutation:false,expert_called:false,secrets_redacted:true}));
