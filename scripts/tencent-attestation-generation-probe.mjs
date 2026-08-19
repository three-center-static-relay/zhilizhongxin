import assert from 'node:assert/strict';

const category=String(process.argv[2]||'');
const current='8f8f3528c9d795497ff26a912a67878af2a02f51';
const previous='8eff4949cc373c859ea95d97c5c21c27551d89b3';
const url='https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation';
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
let body;
try{
  const response=await fetch(url,{headers:{accept:'application/json'},signal:controller.signal});
  body=await response.json().catch(()=>null);
  assert.equal(response.status,200,`ATTESTATION_HTTP_${response.status}`);
}finally{clearTimeout(timer)}

const safeCommon=body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.deploy_probe_active===false;
let matched=false;
if(category==='current-fail')matched=safeCommon&&body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.failed_commit===current&&body?.agent_execution_enabled===false;
else if(category==='previous-fail')matched=safeCommon&&body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.failed_commit===previous&&body?.agent_execution_enabled===false;
else if(category==='current-pass')matched=safeCommon&&body?.validation==='PASS'&&body?.runtime_e2e===true&&body?.attested_commit===current&&body?.selftest==='executor-runtime-v5'&&body?.checks_required===15;
else throw new Error(`UNKNOWN_CATEGORY:${category}`);

console.log(JSON.stringify({suite:'tencent-attestation-generation',category,matched,validation:body?.validation||null,current_generation:body?.failed_commit===current||body?.attested_commit===current,previous_generation:body?.failed_commit===previous}));
assert.equal(matched,true,`ATTESTATION_GENERATION_NOT_MATCHED:${category}`);
