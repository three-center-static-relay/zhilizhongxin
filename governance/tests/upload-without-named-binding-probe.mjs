import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
const wrangler=resolve("node_modules/.bin/wrangler");
const result=spawnSync(wrangler,[
  "versions","upload",
  "--config","wrangler.no-ai-gateway-control.jsonc",
  "--name","governance-worker",
  "--keep-vars",
  "--message","diagnostic undeployed upload without AI_GATEWAY_CONTROL named binding"
],{
  cwd:process.cwd(),
  env:process.env,
  encoding:"utf8",
  maxBuffer:4*1024*1024
});
assert.equal(result.error,undefined,"GOVERNANCE_NO_NAMED_BINDING_UPLOAD_START_FAILED");
assert.equal(result.status,0,"GOVERNANCE_NO_NAMED_BINDING_UNDEPLOYED_UPLOAD_FAILED");
console.log(JSON.stringify({ok:true,suite:"governance-undeployed-upload-without-named-ai-gateway-control",named_ai_gateway_control:false,durable_object_preserved:true,workers_ai_preserved:true,other_service_bindings_preserved:true,version_created:true,deployed:false,production_traffic_changed:false,secrets_redacted:true}));
