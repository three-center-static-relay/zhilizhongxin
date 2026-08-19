import assert from 'node:assert/strict';

const expected='78d8af132074f2ab8edba1001687847e5ee206bc';
const url='https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation';
const c=new AbortController();
const timer=setTimeout(()=>c.abort(),30000);
try{
  const response=await fetch(url,{headers:{accept:'application/json'},signal:c.signal});
  const body=await response.json().catch(()=>null);
  const exact=response.status===200&&body?.validation==='FAIL'&&body?.failed_commit===expected&&body?.fail_closed===true&&body?.secret_values_exposed===false;
  const code=String(body?.failure_code||'');
  const runtime=exact&&/(FAILED=|runtime_http|python_runtime|executor_auth|capability_http|sandbox_tools_visible|commands_visible|files_visible|code_visible|browser_visible|active_selftest_http|shell_exec|file_rw_cleanup|python_exec|chromium_navigation|VALIDATION_FAIL)/i.test(code);
  console.log(JSON.stringify({suite:'tencent-78d-runtime-check-fail',matched:runtime,exact_fail:exact,failure_code_disclosed:false,secret_values_exposed:false}));
  assert.equal(runtime,true,'TENCENT_78D_RUNTIME_CHECK_FAILURE_REQUIRED');
}finally{clearTimeout(timer)}
