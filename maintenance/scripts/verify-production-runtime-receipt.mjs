#!/usr/bin/env node
import {lookup} from "node:dns/promises";

// PR #118 classifier: DNS only. No HTTP request, no Worker call, no broker call, no route mutation.
const HOST="maintenance-worker.a15280020511.workers.dev";
const ATTEMPTS=4,DELAY_MS=3000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
async function main(){let last="NOT_ATTEMPTED";for(let attempt=1;attempt<=ATTEMPTS;attempt++){try{const result=await lookup(HOST,{all:true});if(Array.isArray(result)&&result.length>0){emit({event:"MAINTENANCE_WORKERS_DEV_DNS_PASS",attempt,hostname_resolved:true,address_count:result.length,http_called:false,dynamic_route_mutation:false,expert_called:false});return}last="DNS_EMPTY"}catch(error){last=String(error?.code||error?.message||error).replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,100)}emit({event:"MAINTENANCE_WORKERS_DEV_DNS_RETRY",attempt,error_code:last});if(attempt<ATTEMPTS)await sleep(DELAY_MS)}emit({event:"MAINTENANCE_WORKERS_DEV_DNS_FAIL",error_code:last,http_called:false,dynamic_route_mutation:false,expert_called:false},process.stderr);process.exitCode=1}
main().catch(()=>{emit({event:"MAINTENANCE_WORKERS_DEV_DNS_FAIL",error_code:"UNEXPECTED",http_called:false,dynamic_route_mutation:false,expert_called:false},process.stderr);process.exitCode=1});
