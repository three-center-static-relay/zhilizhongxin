import assert from 'node:assert/strict';

const expected='7e06f53d48df2ea27d9c622bcbb8e984d4555dbc';
const base='https://admin-worker.a15280020511.workers.dev';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function failSample(){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),10000);
  try{
    const response=await fetch(`${base}/_internal/tencent-production-attestation`,{headers:{accept:'application/json'},signal:c.signal});
    const body=await response.json().catch(()=>null);
    return response.status===200&&body?.ok===false&&body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.selftest==='executor-runtime-v5'&&body?.failed_commit===expected&&body?.production_routing===false&&body?.agent_execution_enabled===false&&body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.deploy_probe_active===false&&typeof body?.failure_code==='string'&&body.failure_code.length>0;
  }catch{return false}finally{clearTimeout(timer)}
}

const samples=[];
for(let i=0;i<8;i++){
  samples.push(await failSample());
  if(i<7)await sleep(2500);
}
assert.equal(samples.every(Boolean),true,'TENCENT_7E06_STABLE_FAIL_REQUIRED');
console.log(JSON.stringify({ok:true,suite:'tencent-7e06-stable-fail',failed_commit:expected,samples:samples.length,stable_window_ms:17500,production_routing:false,agent_execution_enabled:false,secret_values_exposed:false}));
