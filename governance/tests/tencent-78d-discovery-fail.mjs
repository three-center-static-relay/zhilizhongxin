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
  const discovery=exact&&/(TENCENT_STABLE_DOMAIN_DISCOVERY_FAILED|TENCENT_MAKERS_API_TOKEN_NOT_CONFIGURED|PROJECT_QUERY_FAILED|PROJECT_NOT_FOUND|PROJECT_HAS_NO_STABLE_DOMAIN|DISCOVERY=)/i.test(code);
  console.log(JSON.stringify({suite:'tencent-78d-discovery-fail',matched:discovery,exact_fail:exact,failure_code_disclosed:false,secret_values_exposed:false}));
  assert.equal(discovery,true,'TENCENT_78D_DISCOVERY_FAILURE_REQUIRED');
}finally{clearTimeout(timer)}
