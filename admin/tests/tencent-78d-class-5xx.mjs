import assert from 'node:assert/strict';
const expected='78d8af132074f2ab8edba1001687847e5ee206bc';
const c=new AbortController(),timer=setTimeout(()=>c.abort(),30000);
try{const r=await fetch('https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation',{headers:{accept:'application/json'},signal:c.signal});const b=await r.json().catch(()=>null);const exact=r.status===200&&b?.validation==='FAIL'&&b?.failed_commit===expected&&b?.fail_closed===true&&b?.secret_values_exposed===false;const matched=exact&&/^HTTP_5\d\d:/i.test(String(b?.failure_code||''));console.log(JSON.stringify({suite:'class-5xx',matched,secret_values_read:false}));assert.equal(matched,true,'HTTP_5XX_REQUIRED')}finally{clearTimeout(timer)}
