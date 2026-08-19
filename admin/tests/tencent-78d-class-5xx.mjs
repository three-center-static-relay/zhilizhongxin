import assert from 'node:assert/strict';
const expected='78d8af132074f2ab8edba1001687847e5ee206bc';
const c=new AbortController(),timer=setTimeout(()=>c.abort(),30000);
try{const r=await fetch('https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation',{headers:{accept:'application/json'},signal:c.signal});const b=await r.json().catch(()=>null);const exact=r.status===200&&b?.validation==='FAIL'&&b?.failed_commit===expected&&b?.fail_closed===true&&b?.secret_values_exposed===false;const code=String(b?.failure_code||'');const matched=exact&&/(TENCENT_E2E_SELFTEST_VERSION_MISMATCH|TENCENT_E2E_STABLE_DOMAIN_REQUIRED|TENCENT_E2E_CHECK_COUNT_MISMATCH)/i.test(code);console.log(JSON.stringify({suite:'receipt-shape',matched,secret_values_read:false}));assert.equal(matched,true,'RECEIPT_SHAPE_REQUIRED')}finally{clearTimeout(timer)}
// atomic PR77 group classifier
