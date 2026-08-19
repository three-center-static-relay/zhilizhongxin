import assert from "node:assert/strict";
const TARGET="543eb94ff34a5f5ef994d1ae5ed2b5b2daa90b2c";
const mode=String(process.argv[2]||"");
assert.match(mode,/^(basic|capability|active)$/,"SUPPORTED_GROUP_REQUIRED");
const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
try{
  const response=await fetch("https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation",{headers:{accept:"application/json"},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  assert.equal(response.status,200);assert.equal(body?.validation,"FAIL");assert.equal(body?.failed_commit,TARGET);assert.equal(body?.fail_closed,true);assert.equal(body?.secret_values_exposed,false);
  const code=String(body?.failure_code||"");
  assert.match(code,/^HTTP_\d{3}:VALIDATION_FAIL:FAILED=/i,"VALIDATION_FAILURE_REQUIRED");
  const failed=(code.match(/:FAILED=([^:]+)/i)?.[1]||"").split(",").filter(Boolean);
  const sets={
    basic:new Set(["stable_domain","runtime_http","python_runtime"]),
    capability:new Set(["executor_auth","capability_http","sandbox_tools_visible","commands_visible","files_visible","code_visible","browser_visible"]),
    active:new Set(["active_selftest_http","shell_exec","file_rw_cleanup","python_exec","chromium_navigation"])
  };
  assert.equal(failed.some(x=>sets[mode].has(x)),true,`FAILED_GROUP_${mode.toUpperCase()}_REQUIRED`);
  console.log(JSON.stringify({ok:true,suite:"tencent-543eb94-failed-check-group",mode,secret_values_read:false,secret_values_exposed:false}));
}finally{clearTimeout(timer)}
