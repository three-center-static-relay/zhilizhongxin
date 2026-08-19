import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";

const required=["ADMIN_GPT_TOKEN","TENCENT_MAKERS_API_TOKEN","TENCENT_EXECUTOR_SHARED_TOKEN"];

if(process.env.WORKERS_CI!=="1"){
  console.log(JSON.stringify({ok:true,skipped:true,suite:"tencent-cloudflare-secret-presence",reason:"NOT_WORKERS_CI"}));
  process.exit(0);
}

const result=spawnSync("npx",["--yes","wrangler@4.123.0","secret","list","--format","json"],{
  encoding:"utf8",env:process.env,maxBuffer:1024*1024
});
if(result.error)throw result.error;
assert.equal(result.status,0,`WRANGLER_SECRET_LIST_FAILED:${String(result.stderr||"").slice(0,300)}`);
let secrets;
try{secrets=JSON.parse(result.stdout)}catch{throw new Error("WRANGLER_SECRET_LIST_INVALID_JSON")}
assert.ok(Array.isArray(secrets),"WRANGLER_SECRET_LIST_NOT_ARRAY");
const names=new Set(secrets.map(x=>String(x?.name||"")));
const missing=required.filter(name=>!names.has(name));
assert.deepEqual(missing,[],`REQUIRED_TENCENT_SECRETS_MISSING:${missing.join(",")}`);
console.log(JSON.stringify({
  ok:true,
  skipped:false,
  suite:"tencent-cloudflare-secret-presence",
  required_secret_names:required,
  required_count:required.length,
  values_read:false
}));
