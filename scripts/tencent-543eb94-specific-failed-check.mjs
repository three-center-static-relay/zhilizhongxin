import assert from "node:assert/strict";
const TARGET="543eb94ff34a5f5ef994d1ae5ed2b5b2daa90b2c";
const allowed=new Set(["stable_domain","runtime_http","python_runtime","executor_auth","capability_http","sandbox_tools_visible","commands_visible","files_visible","code_visible","browser_visible","active_selftest_http","shell_exec","file_rw_cleanup","python_exec","chromium_navigation"]);
const check=String(process.argv[2]||"");
assert.equal(allowed.has(check),true,"SUPPORTED_CHECK_REQUIRED");
const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200);assert.equal(body?.validation,"FAIL");assert.equal(body?.failed_commit,TARGET);assert.equal(body?.fail_closed,true);assert.equal(body?.secret_values_exposed,false);
  const code=String(body?.failure_code||"");assert.match(code,/^HTTP_\d{3}:VALIDATION_FAIL:FAILED=/i);
  const failed=(code.match(/:FAILED=([^:]+)/i)?.[1]||"").split(",").filter(Boolean);
  assert.equal(failed.includes(check),true,`FAILED_CHECK_${check.toUpperCase()}_REQUIRED`);
  console.log(JSON.stringify({ok:true,suite:"tencent-543eb94-specific-failed-check",check,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
