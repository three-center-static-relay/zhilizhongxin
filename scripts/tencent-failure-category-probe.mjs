import assert from 'node:assert/strict';

// Mutually exclusive production-failure classification; this shared-file commit synchronizes all three Worker previews.
const category=String(process.argv[2]||'');
const expected=String(process.argv[3]||'');
const base='https://admin-worker.a15280020511.workers.dev';
assert.match(expected,/^[a-f0-9]{40,64}$/i,'VALID_EXPECTED_COMMIT_REQUIRED');

const c=new AbortController();
const timer=setTimeout(()=>c.abort(),30000);
let body;
try{
  const r=await fetch(`${base}/_internal/tencent-production-attestation`,{headers:{accept:'application/json'},signal:c.signal});
  body=await r.json().catch(()=>null);
  assert.equal(r.status,200,`ATTESTATION_HTTP_${r.status}`);
}finally{clearTimeout(timer)}

const code=String(body?.failure_code||'');
const common=body?.validation==='FAIL'&&body?.runtime_e2e===false&&body?.failed_commit===expected&&body?.fail_closed===true&&body?.secret_values_exposed===false&&body?.agent_execution_enabled===false&&body?.deploy_probe_active===false;
let matched=false;
if(category==='fail-attested')matched=common;
else if(category==='discovery-exact')matched=common&&code.startsWith('HTTP_503:TENCENT_STABLE_DOMAIN_DISCOVERY_FAILED');
else if(category==='validation-exact')matched=common&&code.startsWith('HTTP_502:VALIDATION_FAIL:FAILED=');
else if(category==='timeout-network')matched=common&&/(E2E_REQUEST_TIMEOUT|TENCENT_EXECUTOR_TIMEOUT|fetch_failed|network)/i.test(code);
else throw new Error(`UNKNOWN_CATEGORY:${category}`);

console.log(JSON.stringify({suite:'tencent-production-failure-category',category,matched,validation:body?.validation||null,failed_commit_matches:body?.failed_commit===expected,fail_closed:body?.fail_closed===true,secret_values_exposed:body?.secret_values_exposed===true}));
assert.equal(matched,true,`CATEGORY_NOT_MATCHED:${category}`);
