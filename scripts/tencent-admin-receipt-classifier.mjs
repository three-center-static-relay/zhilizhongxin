import assert from "node:assert/strict";
const CURRENT="54ca74a622ace05ac4ab592e89f5a528b73df458";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,"RECEIPT_ATTESTATION_HTTP_200_REQUIRED");
  assert.equal(body?.validation,"FAIL","RECEIPT_CURRENT_FAIL_REQUIRED");
  assert.equal(body?.failed_commit,CURRENT,"RECEIPT_CURRENT_FAILED_COMMIT_REQUIRED");
  assert.equal(body?.fail_closed,true,"RECEIPT_FAIL_CLOSED_REQUIRED");
  assert.equal(body?.secret_values_exposed,false,"RECEIPT_SECRET_EXPOSURE");
  assert.match(String(body?.failure_code||""),/^TENCENT_E2E_/i,"RECEIPT_FAILURE_CLASS_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"tencent-admin-receipt-classifier",current_fail:true,receipt_class:true,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
