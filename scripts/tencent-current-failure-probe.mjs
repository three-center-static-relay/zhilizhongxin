import assert from "node:assert/strict";

const CURRENT="54ca74a622ace05ac4ab592e89f5a528b73df458";
const mode=String(process.argv[2]||"");
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200,"ATTESTATION_HTTP_200_REQUIRED");
  assert.equal(body?.validation,"FAIL","CURRENT_FAIL_REQUIRED");
  assert.equal(body?.failed_commit,CURRENT,"CURRENT_FAILED_COMMIT_REQUIRED");
  assert.equal(body?.fail_closed,true,"ATTESTATION_FAIL_CLOSED_REQUIRED");
  assert.equal(body?.secret_values_exposed,false,"ATTESTATION_SECRET_EXPOSURE");
  const code=String(body?.failure_code||"");
  let matched=false;
  if(mode==="dual") matched=/^E2E_DUAL_TRANSPORT_FAILED:/i.test(code);
  else if(mode==="http") matched=/^HTTP_\d{3}:/i.test(code);
  else if(mode==="receipt") matched=/^TENCENT_E2E_/i.test(code);
  else throw new Error("SUPPORTED_FAILURE_MODE_REQUIRED");
  assert.equal(matched,true,`CURRENT_FAILURE_${mode.toUpperCase()}_REQUIRED`);
  console.log(JSON.stringify({ok:true,suite:"tencent-current-failure",mode,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
