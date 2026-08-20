#!/usr/bin/env node
import {request as httpsRequest} from "node:https";

// PR #121 control: prove Cloudflare Build can reach the already-established governance workers.dev host over HTTPS.
// Any HTTP response is sufficient. Zero-write; no broker, AI Gateway, or Expert call.
const URL="https://governance-worker.a15280020511.workers.dev/health";
const ATTEMPTS=4,DELAY_MS=3000,TIMEOUT_MS=10000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
function requestOnce(){return new Promise((resolve,reject)=>{const u=new URL(URL);const req=httpsRequest({protocol:u.protocol,hostname:u.hostname,path:u.pathname,method:"GET",headers:{accept:"*/*","user-agent":"expert-v4.1-workers-dev-governance-control"}},res=>{res.resume();res.on("end",()=>resolve({status:res.statusCode||0}))});req.setTimeout(TIMEOUT_MS,()=>req.destroy(new Error("TIMEOUT")));req.on("error",reject);req.end()})}
async function main(){let last="NOT_ATTEMPTED";for(let attempt=1;attempt<=ATTEMPTS;attempt++){try{const{status}=await requestOnce();if(status>=100&&status<=599){emit({event:"GOVERNANCE_WORKERS_DEV_HTTPS_CONTROL_PASS",attempt,http_response_received:true,status_class:`${Math.floor(status/100)}xx`,dynamic_route_mutation:false,broker_called:false,expert_called:false});return}last="NO_HTTP_STATUS"}catch(error){last=String(error?.code||error?.message||error).replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,100)}emit({event:"GOVERNANCE_WORKERS_DEV_HTTPS_CONTROL_RETRY",attempt,error_code:last});if(attempt<ATTEMPTS)await sleep(DELAY_MS)}emit({event:"GOVERNANCE_WORKERS_DEV_HTTPS_CONTROL_FAIL",error_code:last,dynamic_route_mutation:false,broker_called:false,expert_called:false},process.stderr);process.exitCode=1}
main().catch(()=>{emit({event:"GOVERNANCE_WORKERS_DEV_HTTPS_CONTROL_FAIL",error_code:"UNEXPECTED",dynamic_route_mutation:false,broker_called:false,expert_called:false},process.stderr);process.exitCode=1});
