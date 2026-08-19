import assert from "node:assert/strict";
import { request as httpsRequest } from "node:https";
import {validateTencentRuntimeReceipt} from "./cloudflare-worker-gate.mjs";

const base=String(process.argv[2]||"").replace(/\/+$/,""),probe=process.env.TENCENT_E2E_PROBE_TOKEN||"";
assert.match(base,/^https:\/\/[a-z0-9.-]+\.workers\.dev$/i,"VALID_WORKERS_DEV_URL_REQUIRED");
assert.match(probe,/^[a-f0-9]{64}$/i,"VALID_DEPLOY_PROBE_REQUIRED");

const safe=x=>String(x||"").replace(/[^0-9A-Za-z_.:,=-]/g,"_").slice(0,240);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const headers={"x-tencent-deploy-probe":probe,"accept":"application/json"};

async function fetchJson(url,timeoutMs=90000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{method:"POST",headers,signal:controller.signal});
    return {ok:response.ok,status:response.status,body:await response.json().catch(()=>null),transport:"fetch"};
  }finally{clearTimeout(timer)}
}

function httpsJson(url,timeoutMs=90000){
  return new Promise((resolve,reject)=>{
    let settled=false,total=0;
    const req=httpsRequest(url,{method:"POST",headers},response=>{
      const chunks=[];
      response.on("data",chunk=>{
        if(settled)return;
        const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
        total+=part.length;
        if(total>2*1024*1024){
          settled=true;
          req.destroy(new Error("E2E_HTTPS_FALLBACK_RESPONSE_TOO_LARGE"));
          reject(new Error("E2E_HTTPS_FALLBACK_RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(part);
      });
      response.on("end",()=>{
        if(settled)return;
        settled=true;
        const text=Buffer.concat(chunks).toString("utf8");
        let body=null;
        try{body=JSON.parse(text)}catch{}
        const status=Number(response.statusCode||0);
        resolve({ok:status>=200&&status<300,status,body,transport:"https"});
      });
      response.on("error",error=>{if(!settled){settled=true;reject(error)}});
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error("E2E_HTTPS_FALLBACK_TIMEOUT")));
    req.on("error",error=>{if(!settled){settled=true;reject(error)}});
    req.end();
  });
}

async function requestJson(url){
  try{return await fetchJson(url)}
  catch(primaryError){
    try{return await httpsJson(url)}
    catch(fallbackError){
      const primaryClass=safe(primaryError?.name||"FETCH_ERROR");
      const fallbackClass=safe(fallbackError?.code||fallbackError?.name||"HTTPS_ERROR");
      throw new Error(`E2E_DUAL_TRANSPORT_FAILED:${primaryClass}:${fallbackClass}`);
    }
  }
}

let lastError="NO_ATTEMPT";
for(let attempt=1;attempt<=8;attempt++){
  try{
    const result=await requestJson(`${base}/_internal/tencent-deploy-e2e`),body=result.body;
    if(result.ok){
      const receipt=validateTencentRuntimeReceipt(body);
      console.log(JSON.stringify({
        ok:true,
        suite:"tencent-cloudflare-runtime-e2e",
        attempt,
        http_status:result.status,
        transport:result.transport,
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
    lastError=safe(`HTTP_${result.status}:${upstreamError}${failedChecks.length?`:FAILED=${failedChecks.join(",")}`:""}${discoveryAttempts.length?`:DISCOVERY=${discoveryAttempts.join(",")}`:""}`);
    console.error(JSON.stringify({
      ok:false,
      suite:"tencent-cloudflare-runtime-e2e",
      attempt,
      http_status:result.status,
      transport:result.transport,
      error:upstreamError,
      failed_checks:failedChecks,
      discovery_attempt_count:discoveryAttempts.length,
      discovery_reason_codes:discoveryAttempts.map(x=>x.split(":").slice(1).join(":")),
      secret_values_read:false
    }));
  }catch(error){
    lastError=error?.name==="AbortError"?"E2E_REQUEST_TIMEOUT":safe(String(error?.message||error));
  }
  if(attempt<8)await sleep(2000);
}
throw new Error(`TENCENT_POSTDEPLOY_E2E_FAILED:${lastError}`);
