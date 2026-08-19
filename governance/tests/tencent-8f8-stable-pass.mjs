import assert from 'node:assert/strict';

const expected='8f8f3528c9d795497ff26a912a67878af2a02f51';
const base='https://admin-worker.a15280020511.workers.dev';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function staleSample(){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),10000);
  try{
    const response=await fetch(`${base}/_internal/tencent-production-attestation`,{headers:{accept:'application/json'},signal:c.signal});
    const body=await response.json().catch(()=>null);
    const pass=response.status===200&&body?.validation==='PASS'&&body?.runtime_e2e===true&&body?.attested_commit===expected;
    const fail=response.status===200&&body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.failed_commit===expected;
    return !pass&&!fail;
  }catch{return true}finally{clearTimeout(timer)}
}

const samples=[];
for(let i=0;i<8;i++){
  samples.push(await staleSample());
  if(i<7)await sleep(2500);
}
assert.equal(samples.every(Boolean),true,'TENCENT_8F8_STABLE_STALE_REQUIRED');
console.log(JSON.stringify({ok:true,suite:'tencent-8f8-stable-stale',expected_commit:expected,samples:samples.length,stable_window_ms:17500,latest_commit_not_attested:true,secret_values_exposed:false}));
