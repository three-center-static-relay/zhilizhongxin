import assert from 'node:assert/strict';

// Synchronized post-PR trigger: PASS / FAIL / STALE predicates are all prepared before this commit.
const state=String(process.argv[2]||'');
const expected='8f8f3528c9d795497ff26a912a67878af2a02f51';
const base='https://admin-worker.a15280020511.workers.dev';
const c=new AbortController();
const timer=setTimeout(()=>c.abort(),30000);
let response,body;
try{
  response=await fetch(`${base}/_internal/tencent-production-attestation`,{headers:{accept:'application/json'},signal:c.signal});
  body=await response.json().catch(()=>null);
}finally{clearTimeout(timer)}
const pass=response?.status===200&&body?.validation==='PASS'&&body?.runtime_e2e===true&&body?.attested_commit===expected&&body?.selftest==='executor-runtime-v5'&&body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.deploy_probe_active===false;
const fail=response?.status===200&&body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.failed_commit===expected&&body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.agent_execution_enabled===false&&body?.deploy_probe_active===false;
const stale=!pass&&!fail;
let matched=false;
if(state==='pass')matched=pass;
else if(state==='fail')matched=fail;
else if(state==='stale')matched=stale;
else throw new Error(`UNKNOWN_STATE:${state}`);
console.log(JSON.stringify({suite:'tencent-8f8-production-state',state,matched,http_status:response?.status||null,expected_commit:expected,secret_values_exposed:false}));
assert.equal(matched,true,`STATE_NOT_MATCHED:${state}`);
