import assert from "node:assert/strict";
const CURRENT="54ca74a622ace05ac4ab592e89f5a528b73df458";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,"SPAWN_ATTESTATION_HTTP_200_REQUIRED");
  assert.equal(body?.validation,"FAIL","SPAWN_CURRENT_FAIL_REQUIRED");
  assert.equal(body?.failed_commit,CURRENT,"SPAWN_CURRENT_FAILED_COMMIT_REQUIRED");
  assert.equal(body?.fail_closed,true,"SPAWN_FAIL_CLOSED_REQUIRED");
  assert.equal(body?.secret_values_exposed,false,"SPAWN_SECRET_EXPOSURE");
  assert.equal(String(body?.failure_code||""),"E2E_VERIFIER_SPAWN_ERROR","SPAWN_FAILURE_CLASS_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"tencent-admin-spawn-classifier",current_fail:true,spawn_class:true,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
