import assert from 'node:assert/strict';

// Require a sustained state window so overlapping main deployments cannot produce a transient acceptance.
const wanted=String(process.argv[2]||'');
const expected='8f8f3528c9d795497ff26a912a67878af2a02f51';
const base='https://admin-worker.a15280020511.workers.dev';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function observe(){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),10000);
  try{
    const response=await fetch(`${base}/_internal/tencent-production-attestation`,{headers:{accept:'application/json'},signal:c.signal});
    const body=await response.json().catch(()=>null);
    const pass=response.status===200&&body?.validation==='PASS'&&body?.runtime_e2e===true&&body?.attested_commit===expected&&body?.selftest==='executor-runtime-v5'&&body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.deploy_probe_active===false;
    const fail=response.status===200&&body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.failed_commit===expected&&body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.agent_execution_enabled===false&&body?.deploy_probe_active===false;
    return pass?'pass':fail?'fail':'stale';
  }catch{return 'stale'}finally{clearTimeout(timer)}
}

if(!['pass','fail','stale'].includes(wanted))throw new Error(`UNKNOWN_STATE:${wanted}`);
const observed=[];
for(let i=0;i<8;i++){
  observed.push(await observe());
  if(i<7)await sleep(2500);
}
const matched=observed.every(x=>x===wanted);
console.log(JSON.stringify({suite:'tencent-8f8-stable-production-state',wanted,matched,samples:observed.length,stable_window_ms:17500,observed_states:[...new Set(observed)],expected_commit:expected,secret_values_exposed:false}));
assert.equal(matched,true,`STABLE_STATE_NOT_MATCHED:${wanted}`);
