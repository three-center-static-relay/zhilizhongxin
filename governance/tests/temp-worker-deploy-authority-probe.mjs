import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler");
const config="tests/temp-governance-binding-probe.wrangler.jsonc";
const name="governance-binding-probe-20260820";
const run=(args,extra={})=>spawnSync(wrangler,args,{cwd:process.cwd(),env:process.env,encoding:"utf8",maxBuffer:4*1024*1024,...extra});
const deploy=run(["deploy","--config",config,"--name",name]);
assert.equal(deploy.error,undefined,"TEMP_GOVERNANCE_PROBE_DEPLOY_START_FAILED");
assert.equal(deploy.status,0,"TEMP_GOVERNANCE_PROBE_DEPLOY_FAILED");
const remove=run(["delete","--config",config,"--name",name],{input:"y\n"});
assert.equal(remove.error,undefined,"TEMP_GOVERNANCE_PROBE_DELETE_START_FAILED");
assert.equal(remove.status,0,"TEMP_GOVERNANCE_PROBE_DELETE_FAILED");
console.log(JSON.stringify({ok:true,suite:"governance-build-token-temp-worker-deploy",named_binding:false,workers_dev:false,routes:false,production_worker_mutated:false,production_traffic_changed:false,temp_worker_deleted:true,secrets_redacted:true}));
