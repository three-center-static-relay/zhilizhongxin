import assert from 'node:assert/strict';

const category=String(process.argv[2]||'');
const expected='8f8f3528c9d795497ff26a912a67878af2a02f51';
const url='https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation';
const c=new AbortController();
const timer=setTimeout(()=>c.abort(),30000);
let body;
try{
  const response=await fetch(url,{headers:{accept:'application/json'},signal:c.signal});
  body=await response.json().catch(()=>null);
  assert.equal(response.status,200,`ATTESTATION_HTTP_${response.status}`);
}finally{clearTimeout(timer)}

assert.equal(body?.validation,'FAIL','FAIL_ATTESTATION_REQUIRED');
assert.equal(body?.runtime_e2e,false,'RUNTIME_E2E_FALSE_REQUIRED');
assert.equal(body?.failed_commit,expected,'FAILED_COMMIT_MISMATCH');
assert.equal(body?.fail_closed,true,'FAIL_CLOSED_REQUIRED');
assert.equal(body?.agent_execution_enabled,false,'AGENT_MUST_BE_DISABLED');
assert.equal(body?.secret_values_exposed,false,'SECRET_EXPOSURE_FORBIDDEN');
assert.equal(body?.deploy_probe_active,false,'DEPLOY_PROBE_MUST_BE_REMOVED');

const code=String(body?.failure_code||'');
let matched=false;
if(category==='query-failed')matched=code.includes('PROJECT_QUERY_FAILED');
else if(category==='project-not-found')matched=code.includes('PROJECT_NOT_FOUND');
else if(category==='no-stable-domain')matched=code.includes('PROJECT_HAS_NO_STABLE_DOMAIN');
else throw new Error(`UNKNOWN_CATEGORY:${category}`);

console.log(JSON.stringify({suite:'tencent-discovery-inner-cause',category,matched,failed_commit_matches:true,fail_closed:true,secret_values_exposed:false}));
assert.equal(matched,true,`DISCOVERY_CATEGORY_NOT_MATCHED:${category}`);
