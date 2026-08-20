import assert from "node:assert/strict";

assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");

const accountId="e3aec027af13c557bbcb831d29c1e7b4";
const buildUuid="8caf9c28-0a04-4218-a7ae-33ff4714a8e6";
const token=String(process.env.CLOUDFLARE_BUILDS_API_TOKEN||"").trim();
assert.ok(token,"CLOUDFLARE_BUILDS_API_TOKEN_NOT_CONFIGURED");

const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),10000);
try{
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildUuid}/logs`,{
    method:"GET",
    headers:{authorization:`Bearer ${token}`,accept:"application/json"},
    signal:controller.signal
  });
  const payload=await response.json().catch(()=>null);
  assert.equal(response.status,200,`CLOUDFLARE_BUILDS_LOG_READ_HTTP_${response.status}`);
  assert.notEqual(payload,null,"CLOUDFLARE_BUILDS_LOG_JSON_REQUIRED");
  assert.notEqual(payload?.success,false,"CLOUDFLARE_BUILDS_LOG_API_REJECTED");
  const lines=Array.isArray(payload?.result?.lines)?payload.result.lines:Array.isArray(payload?.result)?payload.result:[];
  assert.ok(lines.length>0,"CLOUDFLARE_BUILDS_LOG_LINES_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"governance-builds-api-log-read",build_uuid:buildUuid,log_readable:true,raw_log_emitted:false,token_emitted:false,secrets_redacted:true}));
} finally {
  clearTimeout(timer);
}
