import assert from 'node:assert/strict';

const category=String(process.argv[2]||'');
const expected='7e06f53d48df2ea27d9c622bcbb8e984d4555dbc';
const url='https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation';
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
let status=0,body=null;
try{
  const response=await fetch(url,{headers:{accept:'application/json'},signal:controller.signal});
  status=response.status;
  body=await response.json().catch(()=>null);
}finally{clearTimeout(timer)}

let matched=false;
if(category==='exact-fail')matched=status===200&&body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.failed_commit===expected&&body?.fail_closed===true&&body?.agent_execution_enabled===false&&body?.secret_values_exposed===false&&body?.deploy_probe_active===false;
else if(category==='route-404')matched=status===404;
else if(category==='any-pass')matched=status===200&&body?.validation==='PASS'&&body?.runtime_e2e===true&&body?.selftest==='executor-runtime-v5'&&body?.checks_required===15&&body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.deploy_probe_active===false;
else throw new Error(`UNKNOWN_CATEGORY:${category}`);
console.log(JSON.stringify({suite:'tencent-runtime-state',category,status,matched,validation:body?.validation||null,expected_commit_match:body?.failed_commit===expected||body?.attested_commit===expected}));
assert.equal(matched,true,`RUNTIME_STATE_NOT_MATCHED:${category}`);
