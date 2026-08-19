import assert from 'node:assert/strict';

const bucket=String(process.argv[2]||'');
const expected='c633039823962f90417d95c3ac42471735949d52';
const base='https://admin-worker.a15280020511.workers.dev';
const c=new AbortController();
const timer=setTimeout(()=>c.abort(),30000);
let response,body;
try{
  response=await fetch(`${base}/_internal/tencent-production-attestation`,{headers:{accept:'application/json'},signal:c.signal});
  body=await response.json().catch(()=>null);
}finally{clearTimeout(timer)}
assert.equal(response?.status,200,`ATTESTATION_HTTP_${response?.status}`);
const common=body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.failed_commit===expected&&body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.agent_execution_enabled===false;
assert.equal(common,true,'C633_FAIL_ATTESTATION_REQUIRED');
const code=String(body?.failure_code||'');
const network=/(fetch_failed|network|E2E_REQUEST_TIMEOUT|TENCENT_EXECUTOR_TIMEOUT|AbortError|timed?out|TIMEOUT)/i.test(code);
const auth=!network&&/(executor_auth|HTTP_401|UNAUTHORIZED|401)/i.test(code);
const runtime=!network&&!auth&&/(FAILED=|VALIDATION_FAIL|runtime_http|python_runtime|capability_http|active_selftest_http|sandbox_tools_visible|commands_visible|files_visible|code_visible|browser_visible|shell_exec|file_rw_cleanup|python_exec|chromium_navigation)/i.test(code);
let matched=false;
if(bucket==='network')matched=network;
else if(bucket==='auth')matched=auth;
else if(bucket==='runtime')matched=runtime;
else throw new Error(`UNKNOWN_BUCKET:${bucket}`);
console.log(JSON.stringify({suite:'tencent-c633-failure-bucket',bucket,matched,fail_attested:true,failed_commit_matches:true,code_disclosed:false}));
assert.equal(matched,true,`BUCKET_NOT_MATCHED:${bucket}`);
