import assert from "node:assert/strict";

const CURRENT="54ca74a622ace05ac4ab592e89f5a528b73df458";
const mode=String(process.argv[2]||"");
assert.match(mode,/^(baseline|dual|receipt)$/,"SUPPORTED_ATOMIC_MODE_REQUIRED");
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,"ATOMIC_ATTESTATION_HTTP_200_REQUIRED");
  assert.equal(body?.validation,"FAIL","ATOMIC_CURRENT_FAIL_REQUIRED");
  assert.equal(body?.failed_commit,CURRENT,"ATOMIC_CURRENT_FAILED_COMMIT_REQUIRED");
  assert.equal(body?.fail_closed,true,"ATOMIC_FAIL_CLOSED_REQUIRED");
  assert.equal(body?.secret_values_exposed,false,"ATOMIC_SECRET_EXPOSURE");
  const code=String(body?.failure_code||"");
  if(mode==="dual") assert.match(code,/^E2E_DUAL_TRANSPORT_FAILED:/i,"ATOMIC_DUAL_TRANSPORT_FAILURE_REQUIRED");
  if(mode==="receipt") assert.match(code,/^TENCENT_E2E_/i,"ATOMIC_RUNTIME_RECEIPT_FAILURE_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"tencent-54ca-atomic-classifier",mode,current_fail:true,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
