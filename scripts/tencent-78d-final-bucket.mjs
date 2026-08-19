import assert from 'node:assert/strict';

const category=String(process.argv[2]||'');
const expected='78d8af132074f2ab8edba1001687847e5ee206bc';
const url='https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation';
const c=new AbortController();
const timer=setTimeout(()=>c.abort(),30000);
try{
  const response=await fetch(url,{headers:{accept:'application/json'},signal:c.signal});
  const body=await response.json().catch(()=>null);
  const exact=response.status===200&&body?.validation==='FAIL'&&body?.failed_commit===expected&&body?.fail_closed===true&&body?.secret_values_exposed===false;
  const code=String(body?.failure_code||'');
  const secret=exact&&/TENCENT_EXECUTOR_SHARED_TOKEN_NOT_CONFIGURED/i.test(code);
  const domain=exact&&!secret&&/(TENCENT_EXECUTOR_DOMAIN_EMPTY|TENCENT_EXECUTOR_URL_INVALID|TENCENT_EXECUTOR_URL_MUST_BE_HTTPS|TENCENT_EXECUTOR_HOST_INVALID)/i.test(code);
  const runtime=exact&&!secret&&!domain&&/(FAILED=|VALIDATION_FAIL|runtime_http|python_runtime|executor_auth|capability_http|sandbox_tools_visible|commands_visible|files_visible|code_visible|browser_visible|active_selftest_http|shell_exec|file_rw_cleanup|python_exec|chromium_navigation)/i.test(code);
  let matched=false;
  if(category==='secret')matched=secret;
  else if(category==='domain')matched=domain;
  else if(category==='runtime')matched=runtime;
  else throw new Error(`UNKNOWN_CATEGORY:${category}`);
  console.log(JSON.stringify({suite:'tencent-78d-final-bucket',category,matched,exact_fail:exact,failure_code_disclosed:false,secret_values_exposed:false}));
  assert.equal(matched,true,`TENCENT_78D_FINAL_BUCKET_NOT_MATCHED:${category}`);
}finally{clearTimeout(timer)}
