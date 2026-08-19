import assert from 'node:assert/strict';

const group=String(process.argv[2]||'');
const expected='78d8af132074f2ab8edba1001687847e5ee206bc';
const url='https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation';
const c=new AbortController();
const timer=setTimeout(()=>c.abort(),30000);
try{
  const response=await fetch(url,{headers:{accept:'application/json'},signal:c.signal});
  const body=await response.json().catch(()=>null);
  const exact=response.status===200&&body?.validation==='FAIL'&&body?.failed_commit===expected&&body?.fail_closed===true&&body?.secret_values_exposed===false;
  const code=String(body?.failure_code||'');
  const identity=exact&&/(TENCENT_E2E_OK_REQUIRED|TENCENT_E2E_PASS_REQUIRED|TENCENT_E2E_SELFTEST_VERSION_MISMATCH)/i.test(code);
  const shape=exact&&!identity&&/(TENCENT_E2E_STABLE_DOMAIN_REQUIRED|TENCENT_E2E_CHECK_COUNT_MISMATCH)/i.test(code);
  const check=exact&&!identity&&!shape&&/TENCENT_E2E_CHECK_FAILED:/i.test(code);
  let matched=false;
  if(group==='identity')matched=identity;
  else if(group==='shape')matched=shape;
  else if(group==='check')matched=check;
  else throw new Error(`UNKNOWN_GROUP:${group}`);
  console.log(JSON.stringify({suite:'tencent-78d-receipt-contract',group,matched,exact_fail:exact,failure_code_disclosed:false,secret_values_exposed:false}));
  assert.equal(matched,true,`TENCENT_78D_RECEIPT_GROUP_NOT_MATCHED:${group}`);
}finally{clearTimeout(timer)}
