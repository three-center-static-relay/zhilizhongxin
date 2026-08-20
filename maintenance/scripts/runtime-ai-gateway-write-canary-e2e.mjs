#!/usr/bin/env node
import {request as httpsRequest} from "node:https";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const MAX_ATTEMPTS=3,INITIAL_SETTLE_MS=1500,RETRY_DELAY_MS=1500,REQUEST_TIMEOUT_MS=15000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function safeCode(v){return String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,140)}
function validate(body){
  if(body?.ok!==true)throw new Error(`WRITE_CANARY_NOT_OK:${safeCode(body?.error_code||"UNKNOWN")}`);
  if(body?.selftest!=="maintenance-ai-gateway-write-canary-v1")throw new Error("WRITE_CANARY_VERSION_MISMATCH");
  if(body?.permission!=="ai_gateway_write")throw new Error("WRITE_CANARY_PERMISSION_MARKER_MISSING");
  if(body?.created!==true||body?.verified!==true||body?.deleted!==true)throw new Error("WRITE_CANARY_LIFECYCLE_INCOMPLETE");
  if(body?.temporary_dynamic_route_mutation!==true||body?.temporary_route_deleted!==true)throw new Error("WRITE_CANARY_CLEANUP_REQUIRED");
  if(body?.production_route_changed!==false||body?.model_invoked!==false)throw new Error("WRITE_CANARY_SCOPE_VIOLATION");
  if(body?.production_worker_mutated!==false||body?.production_worker_traffic_changed!==false)throw new Error("WRITE_CANARY_WORKER_SCOPE_VIOLATION");
  if(body?.secrets_redacted!==true)throw new Error("WRITE_CANARY_REDACTION_REQUIRED");
  return body;
}
function requestJson(url,probe){return new Promise((resolvePromise,reject)=>{const target=new URL(url);const req=httpsRequest({protocol:target.protocol,hostname:target.hostname,port:target.port||443,path:target.pathname+target.search,method:"GET",headers:{accept:"application/json","x-maintenance-e2e-probe":probe}},res=>{let data="";res.setEncoding("utf8");res.on("data",chunk=>{data+=chunk;if(data.length>65536)req.destroy(new Error("BODY_TOO_LARGE"))});res.on("end",()=>{let body=null;try{body=data?JSON.parse(data):null}catch{return reject(new Error("BAD_JSON"))}resolvePromise({status:res.statusCode||0,body})})});req.setTimeout(REQUEST_TIMEOUT_MS,()=>req.destroy(new Error("TIMEOUT")));req.on("error",reject);req.end()})}
async function main(){
  const base=String(process.argv[2]||"").replace(/\/$/,""),probe=String(process.env.MAINTENANCE_E2E_PROBE_TOKEN||"");
  if(!base||!probe){console.error("AI_GATEWAY_WRITE_CANARY_E2E_FAILED:CONFIG_REQUIRED");process.exitCode=1;return}
  await sleep(INITIAL_SETTLE_MS);let last="NOT_ATTEMPTED";
  for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
    try{const{status,body}=await requestJson(`${base}/v1/maintenance/runtime-write-canary`,probe);if(status!==200)last=`HTTP_${status}:${safeCode(body?.error_code||body?.error||"UNKNOWN")}`;else{validate(body);console.log(JSON.stringify({ok:true,event:"AI_GATEWAY_WRITE_CANARY_PASS",permission:"ai_gateway_write",temporary_route_created:true,temporary_route_deleted:true,model_invoked:false,production_route_changed:false,secrets_redacted:true}));return}}catch(error){last=safeCode(error?.message||error)}
    if(attempt<MAX_ATTEMPTS)await sleep(RETRY_DELAY_MS);
  }
  console.error(`AI_GATEWAY_WRITE_CANARY_E2E_FAILED:${safeCode(last)}`);process.exitCode=1;
}
const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invoked)main().catch(()=>{console.error("AI_GATEWAY_WRITE_CANARY_E2E_FAILED:UNEXPECTED");process.exitCode=1});
