import assert from 'node:assert/strict';

const expected='78d8af132074f2ab8edba1001687847e5ee206bc';
const url='https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation';
const c=new AbortController();
const timer=setTimeout(()=>c.abort(),30000);
try{
  const response=await fetch(url,{headers:{accept:'application/json'},signal:c.signal});
  const body=await response.json().catch(()=>null);
  const matched=response.status===200&&body?.ok===false&&body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.selftest==='executor-runtime-v5'&&body?.failed_commit===expected&&body?.production_routing===false&&body?.agent_execution_enabled===false&&body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.deploy_probe_active===false&&typeof body?.failure_code==='string'&&body.failure_code.length>0;
  console.log(JSON.stringify({suite:'tencent-78d-exact-fail',matched,http_status:response.status,failed_commit_match:body?.failed_commit===expected,secret_values_exposed:false}));
  assert.equal(matched,true,'TENCENT_78D_EXACT_FAIL_REQUIRED');
}finally{clearTimeout(timer)}
