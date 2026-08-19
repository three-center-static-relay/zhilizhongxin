import assert from "node:assert/strict";
const CURRENT="54ca74a622ace05ac4ab592e89f5a528b73df458";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,"TIMEOUT_ATTESTATION_HTTP_200_REQUIRED");
  assert.equal(body?.validation,"FAIL","TIMEOUT_CURRENT_FAIL_REQUIRED");
  assert.equal(body?.failed_commit,CURRENT,"TIMEOUT_CURRENT_FAILED_COMMIT_REQUIRED");
  assert.equal(body?.fail_closed,true,"TIMEOUT_FAIL_CLOSED_REQUIRED");
  assert.equal(body?.secret_values_exposed,false,"TIMEOUT_SECRET_EXPOSURE");
  assert.equal(String(body?.failure_code||""),"E2E_REQUEST_TIMEOUT","TIMEOUT_FAILURE_CLASS_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"tencent-admin-timeout-classifier",current_fail:true,timeout_class:true,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
