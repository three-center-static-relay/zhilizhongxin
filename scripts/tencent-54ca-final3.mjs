import assert from "node:assert/strict";
const CURRENT="54ca74a622ace05ac4ab592e89f5a528b73df458";
const mode=String(process.argv[2]||"");
assert.match(mode,/^(receipt|spawn|exit)$/,"SUPPORTED_FINAL3_MODE_REQUIRED");
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,"FINAL3_ATTESTATION_HTTP_200_REQUIRED");
  assert.equal(body?.validation,"FAIL","FINAL3_CURRENT_FAIL_REQUIRED");
  assert.equal(body?.failed_commit,CURRENT,"FINAL3_CURRENT_FAILED_COMMIT_REQUIRED");
  assert.equal(body?.fail_closed,true,"FINAL3_FAIL_CLOSED_REQUIRED");
  assert.equal(body?.secret_values_exposed,false,"FINAL3_SECRET_EXPOSURE");
  const code=String(body?.failure_code||"");
  if(mode==="receipt")assert.match(code,/^TENCENT_E2E_/i,"FINAL3_RECEIPT_REQUIRED");
  else if(mode==="spawn")assert.equal(code,"E2E_VERIFIER_SPAWN_ERROR","FINAL3_SPAWN_REQUIRED");
  else assert.match(code,/^E2E_EXIT_/i,"FINAL3_EXIT_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"tencent-54ca-final3",mode,current_fail:true,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
