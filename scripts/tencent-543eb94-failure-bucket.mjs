import assert from "node:assert/strict";

const TARGET="543eb94ff34a5f5ef994d1ae5ed2b5b2daa90b2c";
const mode=String(process.argv[2]||"");
assert.match(mode,/^(http|receipt|transport)$/,"SUPPORTED_MODE_REQUIRED");
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,"ATTESTATION_HTTP_200_REQUIRED");
  assert.equal(body?.validation,"FAIL","CURRENT_FAIL_REQUIRED");
  assert.equal(body?.failed_commit,TARGET,"TARGET_FAILED_COMMIT_REQUIRED");
  assert.equal(body?.fail_closed,true,"FAIL_CLOSED_REQUIRED");
  assert.equal(body?.secret_values_exposed,false,"SECRET_EXPOSURE_FORBIDDEN");
  const code=String(body?.failure_code||"");
  if(mode==="http") assert.match(code,/^HTTP_\d{3}:/i,"HTTP_FAILURE_REQUIRED");
  if(mode==="receipt") assert.match(code,/^TENCENT_E2E_/i,"RECEIPT_FAILURE_REQUIRED");
  if(mode==="transport") assert.match(code,/^(?:E2E_(?:DUAL_TRANSPORT_FAILED|REQUEST_TIMEOUT|EXIT_|VERIFIER_).*)/i,"TRANSPORT_FAILURE_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"tencent-543eb94-failure-bucket",mode,failed_commit:TARGET,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
