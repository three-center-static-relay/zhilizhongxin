import assert from 'node:assert/strict';

const expected='8f8f3528c9d795497ff26a912a67878af2a02f51';
const base='https://admin-worker.a15280020511.workers.dev';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function passSample(){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),10000);
  try{
    const response=await fetch(`${base}/_internal/tencent-production-attestation`,{headers:{accept:'application/json'},signal:c.signal});
    const body=await response.json().catch(()=>null);
    return response.status===200&&body?.ok===true&&body?.validation==='PASS'&&body?.runtime_e2e===true&&body?.selftest==='executor-runtime-v5'&&body?.attested_commit===expected&&body?.checks_required===15&&body?.stable_domain_required===true&&body?.shell_file_python_chromium_required===true&&body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.deploy_probe_active===false;
  }catch{return false}finally{clearTimeout(timer)}
}

const samples=[];
for(let i=0;i<8;i++){
  samples.push(await passSample());
  if(i<7)await sleep(2500);
}
assert.equal(samples.every(Boolean),true,'TENCENT_8F8_STABLE_PASS_REQUIRED');
console.log(JSON.stringify({ok:true,suite:'tencent-8f8-stable-pass',attested_commit:expected,samples:samples.length,stable_window_ms:17500,runtime_e2e:true,checks_required:15,deploy_probe_active:false,secret_values_exposed:false}));
