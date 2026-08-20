import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler");
const result=spawnSync(wrangler,[
  "versions","upload",
  "--config","tests/minimal-upload-probe.wrangler.jsonc",
  "--name","governance-worker",
  "--keep-vars",
  "--message","diagnostic undeployed upload: minimal governance script only"
],{
  cwd:process.cwd(),
  env:process.env,
  encoding:"utf8",
  maxBuffer:4*1024*1024
});
assert.equal(result.error,undefined,"GOVERNANCE_MINIMAL_UPLOAD_WRANGLER_START_FAILED");
assert.equal(result.status,0,"GOVERNANCE_MINIMAL_UNDEPLOYED_VERSION_UPLOAD_FAILED");
console.log(JSON.stringify({ok:true,suite:"governance-minimal-undeployed-version-upload",worker:"governance-worker",minimal_config:true,service_bindings:false,durable_objects:false,workers_ai:false,version_created:true,deployed:false,production_traffic_changed:false,secrets_redacted:true}));
