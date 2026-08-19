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
  const matched=exact&&/^HTTP_502:/i.test(code);
  console.log(JSON.stringify({suite:'tencent-78d-http502',matched,exact_fail:exact,secret_values_read:false,secret_values_exposed:false}));
  assert.equal(matched,true,'TENCENT_78D_HTTP_502_REQUIRED');
}finally{clearTimeout(timer)}
