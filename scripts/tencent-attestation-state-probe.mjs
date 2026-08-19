import assert from "node:assert/strict";

const OLD="78d8af132074f2ab8edba1001687847e5ee206bc";
const CURRENT="54ca74a622ace05ac4ab592e89f5a528b73df458";
const mode=String(process.argv[2]||"");
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,"ATTESTATION_HTTP_200_REQUIRED");
  assert.equal(body?.fail_closed,true,"ATTESTATION_FAIL_CLOSED_REQUIRED");
  assert.equal(body?.secret_values_exposed,false,"ATTESTATION_SECRET_EXPOSURE");
  if(mode==="new-fail"){
    assert.equal(body?.validation,"FAIL","CURRENT_FAIL_REQUIRED");
    assert.equal(body?.failed_commit,CURRENT,"CURRENT_FAILED_COMMIT_REQUIRED");
  }else if(mode==="old-fail"){
    assert.equal(body?.validation,"FAIL","OLD_FAIL_REQUIRED");
    assert.equal(body?.failed_commit,OLD,"OLD_FAILED_COMMIT_REQUIRED");
  }else{
    throw new Error("SUPPORTED_STATE_MODE_REQUIRED");
  }
  console.log(JSON.stringify({ok:true,suite:"tencent-attestation-state",mode,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
