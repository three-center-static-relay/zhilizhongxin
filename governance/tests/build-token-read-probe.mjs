import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler");
const result=spawnSync(wrangler,["deployments","status","--name","governance-worker","--json"],{
  cwd:process.cwd(),
  env:process.env,
  encoding:"utf8",
  maxBuffer:1024*1024
});
assert.equal(result.error,undefined,"GOVERNANCE_BUILD_TOKEN_WRANGLER_START_FAILED");
assert.equal(result.status,0,"GOVERNANCE_BUILD_TOKEN_READ_FAILED");
let parsed;
try{parsed=JSON.parse(result.stdout||"null")}catch{assert.fail("GOVERNANCE_BUILD_TOKEN_JSON_INVALID")}
assert.ok(parsed!==null,"GOVERNANCE_DEPLOYMENT_STATUS_REQUIRED");
console.log(JSON.stringify({ok:true,suite:"governance-build-token-read",worker:"governance-worker",authenticated_read:true,secrets_redacted:true}));
