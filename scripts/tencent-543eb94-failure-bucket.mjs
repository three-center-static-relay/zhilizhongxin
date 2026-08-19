import assert from "node:assert/strict";

const TARGET="543eb94ff34a5f5ef994d1ae5ed2b5b2daa90b2c";
const mode=String(process.argv[2]||"");
assert.match(mode,/^(http-validation|http-discovery|http-config-timeout)$/,"SUPPORTED_MODE_REQUIRED");
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
  assert.match(code,/^HTTP_\d{3}:/i,"HTTP_FAILURE_REQUIRED");
  if(mode==="http-validation") assert.match(code,/^HTTP_\d{3}:VALIDATION_FAIL:FAILED=/i,"HTTP_VALIDATION_FAILED_CHECKS_REQUIRED");
  if(mode==="http-discovery") assert.match(code,/^HTTP_\d{3}:TENCENT_STABLE_DOMAIN_DISCOVERY_FAILED/i,"HTTP_DISCOVERY_FAILURE_REQUIRED");
  if(mode==="http-config-timeout") assert.match(code,/^HTTP_\d{3}:(?:TENCENT_EXECUTOR_TIMEOUT|TENCENT_(?:EXECUTOR|MAKERS)_[A-Z0-9_]*(?:NOT_CONFIGURED|FAILED|INVALID|EMPTY))/i,"HTTP_CONFIG_TIMEOUT_FAILURE_REQUIRED");
  console.log(JSON.stringify({ok:true,suite:"tencent-543eb94-http-subclass",mode,failed_commit:TARGET,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
