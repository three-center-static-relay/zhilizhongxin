#!/usr/bin/env node
import {request as httpsRequest} from "node:https";

// PR #118 classifier stage 0: prove only that production maintenance /health is reachable over HTTPS.
// Zero-write: no Cloudflare account control, no broker RPC requirement, no AI Gateway mutation.
const URL="https://maintenance-worker.a15280020511.workers.dev/health";
const ATTEMPTS=4,DELAY_MS=3000,TIMEOUT_MS=10000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
function getJson(){return new Promise((resolve,reject)=>{const u=new URL(URL);const req=httpsRequest({protocol:u.protocol,hostname:u.hostname,path:u.pathname,method:"GET",headers:{accept:"application/json","user-agent":"expert-v4.1-maintenance-health-verifier"}},res=>{let data="";res.setEncoding("utf8");res.on("data",chunk=>{data+=chunk;if(data.length>131072)req.destroy(new Error("BODY_TOO_LARGE"))});res.on("end",()=>{let body=null;try{body=data?JSON.parse(data):null}catch{return reject(new Error("BAD_JSON"))}resolve({status:res.statusCode||0,body})})});req.setTimeout(TIMEOUT_MS,()=>req.destroy(new Error("TIMEOUT")));req.on("error",reject);req.end()})}
async function main(){let last="NOT_ATTEMPTED";for(let attempt=1;attempt<=ATTEMPTS;attempt++){try{const{status,body}=await getJson();if(status===200&&body?.ok===true&&String(body?.service||"")==="maintenance-worker"){emit({event:"MAINTENANCE_PRODUCTION_HEALTH_REACHABLE_PASS",attempt,http_status:status,service:"maintenance-worker",api_version_present:Boolean(body?.api_version),dynamic_route_mutation:false,expert_called:false});return}last=status!==200?`HTTP_${status}`:body?.ok!==true?"HEALTH_NOT_OK":"SERVICE_MISMATCH"}catch(error){last=String(error?.message||error).replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,100)}emit({event:"MAINTENANCE_PRODUCTION_HEALTH_REACHABLE_RETRY",attempt,error_code:last});if(attempt<ATTEMPTS)await sleep(DELAY_MS)}emit({event:"MAINTENANCE_PRODUCTION_HEALTH_REACHABLE_FAIL",error_code:last,dynamic_route_mutation:false,expert_called:false},process.stderr);process.exitCode=1}
main().catch(()=>{emit({event:"MAINTENANCE_PRODUCTION_HEALTH_REACHABLE_FAIL",error_code:"UNEXPECTED",dynamic_route_mutation:false,expert_called:false},process.stderr);process.exitCode=1});
