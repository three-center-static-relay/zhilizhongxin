import assert from "node:assert/strict";
import {validateTencentRuntimeReceipt} from "./cloudflare-worker-gate.mjs";

const base=String(process.argv[2]||"").replace(/\/+$/,""),probe=process.env.TENCENT_E2E_PROBE_TOKEN||"";
assert.match(base,/^https:\/\/[a-z0-9.-]+\.workers\.dev$/i,"VALID_WORKERS_DEV_URL_REQUIRED");
assert.match(probe,/^[a-f0-9]{64}$/i,"VALID_DEPLOY_PROBE_REQUIRED");

const safe=x=>String(x||"").replace(/[^0-9A-Za-z_.:,=-]/g,"_").slice(0,240);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastError="NO_ATTEMPT";
for(let attempt=1;attempt<=8;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  try{
    const response=await fetch(`${base}/_internal/tencent-deploy-e2e`,{
      method:"POST",
      headers:{"x-tencent-deploy-probe":probe,"accept":"application/json"},
      signal:controller.signal
    });
    const body=await response.json().catch(()=>null);
    if(response.ok){
      const receipt=validateTencentRuntimeReceipt(body);
      console.log(JSON.stringify({
        ok:true,
        suite:"tencent-cloudflare-runtime-e2e",
        attempt,
        http_status:response.status,
        validation:receipt.validation,
        selftest:receipt.selftest,
        resolved_executor:receipt.resolved_executor,
        checks:receipt.checks.map(({name,ok})=>({name,ok})),
        secret_values_read:false,
        arbitrary_execution:false
      }));
      process.exit(0);
    }
    const failedChecks=Array.isArray(body?.checks)?body.checks.filter(x=>x?.ok!==true).map(x=>String(x?.name||"unknown")):[];
    const upstreamError=safe(body?.error||body?.message||"VALIDATION_FAIL");
    const discoveryAttempts=Array.isArray(body?.details?.attempts)?body.details.attempts.map(x=>safe(x)).filter(Boolean):[];
    lastError=safe(`HTTP_${response.status}:${upstreamError}${failedChecks.length?`:FAILED=${failedChecks.join(",")}`:""}${discoveryAttempts.length?`:DISCOVERY=${discoveryAttempts.join(",")}`:""}`);
    console.error(JSON.stringify({
      ok:false,
      suite:"tencent-cloudflare-runtime-e2e",
      attempt,
      http_status:response.status,
      error:upstreamError,
      failed_checks:failedChecks,
      discovery_attempt_count:discoveryAttempts.length,
      discovery_reason_codes:discoveryAttempts.map(x=>x.split(":").slice(1).join(":")),
      secret_values_read:false
    }));
  }catch(error){
    lastError=error?.name==="AbortError"?"E2E_REQUEST_TIMEOUT":safe(String(error?.message||error));
  }finally{clearTimeout(timer)}
  if(attempt<8)await sleep(2000);
}
throw new Error(`TENCENT_POSTDEPLOY_E2E_FAILED:${lastError}`);
