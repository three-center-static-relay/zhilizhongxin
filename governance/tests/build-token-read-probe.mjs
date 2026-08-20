import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler");
const result=spawnSync(wrangler,[
  "versions","upload",
  "--config","wrangler.jsonc",
  "--name","governance-worker",
  "--keep-vars",
  "--message","diagnostic undeployed upload: validate current governance bindings only"
],{
  cwd:process.cwd(),
  env:process.env,
  encoding:"utf8",
  maxBuffer:4*1024*1024
});
assert.equal(result.error,undefined,"GOVERNANCE_VERSION_UPLOAD_WRANGLER_START_FAILED");
assert.equal(result.status,0,"GOVERNANCE_UNDEPLOYED_VERSION_UPLOAD_FAILED");
console.log(JSON.stringify({ok:true,suite:"governance-undeployed-version-upload",worker:"governance-worker",version_created:true,deployed:false,production_traffic_changed:false,secrets_redacted:true}));
