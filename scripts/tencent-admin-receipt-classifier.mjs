import assert from "node:assert/strict";
const CURRENT="54ca74a622ace05ac4ab592e89f5a528b73df458";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,"PARSER_ATTESTATION_HTTP_200_REQUIRED");
  assert.equal(body?.validation,"FAIL","PARSER_CURRENT_FAIL_REQUIRED");
  assert.equal(body?.failed_commit,CURRENT,"PARSER_CURRENT_FAILED_COMMIT_REQUIRED");
  assert.equal(body?.fail_closed,true,"PARSER_FAIL_CLOSED_REQUIRED");
  assert.equal(body?.secret_values_exposed,false,"PARSER_SECRET_EXPOSURE");
  assert.match(String(body?.failure_code||""),/lastError/i,"PARSER_TEMPLATE_CAPTURE_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"tencent-admin-parser-template-classifier",current_fail:true,template_capture:true,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
