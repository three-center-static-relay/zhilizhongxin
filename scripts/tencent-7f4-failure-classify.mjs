import assert from 'node:assert/strict';

const category=String(process.argv[2]||'');
const expected='7f4b3397cc693cc07669747f3c04e3077415efaa';
const url='https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation';
const c=new AbortController();
const timer=setTimeout(()=>c.abort(),30000);
try {
  const response=await fetch(url,{headers:{accept:'application/json'},signal:c.signal});
  const body=await response.json().catch(()=>null);
  const exactFail=response.status===200&&body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.failed_commit===expected&&body?.fail_closed===true&&body?.agent_execution_enabled===false&&body?.secret_values_exposed===false&&body?.deploy_probe_active===false;
  const code=String(body?.failure_code||'');
  const auth=exactFail&&/(HTTP_401|HTTP_403|UNAUTHORIZED|executor_auth|authentication|authorization)/i.test(code);
  const runtime=exactFail&&!auth&&/(FAILED=|shell_exec|file_rw_cleanup|python_exec|chromium_navigation|runtime_http|python_runtime|capability_http|active_selftest_http|sandbox_tools_visible|commands_visible|files_visible|code_visible|browser_visible)/i.test(code);
  const other=exactFail&&!auth&&!runtime;
  let matched=false;
  if(category==='auth')matched=auth;
  else if(category==='runtime')matched=runtime;
  else if(category==='other')matched=other;
  else throw new Error(`UNKNOWN_CATEGORY:${category}`);
  console.log(JSON.stringify({suite:'tencent-7f4-failure-classification',category,matched,exact_fail:exactFail,failure_code_disclosed:false,secret_values_exposed:false}));
  assert.equal(matched,true,`TENCENT_7F4_CATEGORY_NOT_MATCHED:${category}`);
} finally { clearTimeout(timer); }
