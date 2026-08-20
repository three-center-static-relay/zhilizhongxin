#!/usr/bin/env node
import {request as httpsRequest} from "node:https";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const MAX_ATTEMPTS=2,INITIAL_SETTLE_MS=1000,RETRY_DELAY_MS=2500,REQUEST_TIMEOUT_MS=90000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function safe(v){return String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,180)}
function requestJson(url,probe){return new Promise((resolvePromise,reject)=>{const u=new URL(url),req=httpsRequest({protocol:u.protocol,hostname:u.hostname,port:u.port||443,path:u.pathname+u.search,method:"POST",headers:{accept:"application/json","content-length":"0","x-maintenance-e2e-probe":probe}},res=>{let data="";res.setEncoding("utf8");res.on("data",c=>{data+=c;if(data.length>262144)req.destroy(new Error("BODY_TOO_LARGE"))});res.on("end",()=>{let body=null;try{body=data?JSON.parse(data):null}catch{return reject(new Error("BAD_JSON"))}resolvePromise({status:res.statusCode||0,body})})});req.setTimeout(REQUEST_TIMEOUT_MS,()=>req.destroy(new Error("TIMEOUT")));req.on("error",reject);req.end()})}
function validate(body){
  if(body?.ok!==true)throw new Error(`ROUTE_REFRESH_NOT_OK_${safe(body?.error_code)}`);
  if(body?.selftest!=="maintenance-expert-route-refresh-v1")throw new Error("ROUTE_REFRESH_VERSION_MISMATCH");
  if(body?.status!=="active")throw new Error("ROUTE_REFRESH_ACTIVE_REQUIRED");
  if(body?.model_id_pinning!==false||body?.future_models_auto_discover!==true)throw new Error("ROUTE_REFRESH_DYNAMIC_POLICY_REQUIRED");
  if(body?.route_selection!=="global-lane-pair"||Number(body?.max_lanes_per_route)!==2||Number(body?.max_elements_per_route)!==16)throw new Error("ROUTE_REFRESH_SHARD_POLICY_REQUIRED");
  if(!(Number(body?.candidate_count)>0)||!(Number(body?.company_count)>=2))throw new Error("ROUTE_REFRESH_UNIVERSE_REQUIRED");
  const expected=Math.ceil(Math.min(8,Number(body.company_count))/2);
  if(!Array.isArray(body?.route_family)||body.route_family.length!==expected||expected<1||expected>4)throw new Error("ROUTE_REFRESH_FAMILY_REQUIRED");
  const seen=new Set();
  for(const r of body.route_family){
    if(!/^expert-panel-lanes-(1-2|3-4|5-6|7-8)-v1$/.test(String(r?.route_name||"")))throw new Error("ROUTE_REFRESH_SHARD_NAME_INVALID");
    if(seen.has(r.route_name))throw new Error("ROUTE_REFRESH_SHARD_DUPLICATE");seen.add(r.route_name);
    if(!r?.route_id||!r?.version_id)throw new Error("ROUTE_REFRESH_RECEIPT_INCOMPLETE");
    if(!Array.isArray(r?.lanes)||r.lanes.length<1||r.lanes.length>2)throw new Error("ROUTE_REFRESH_LANE_BUDGET_EXCEEDED");
    if(Number(r?.element_count)>16)throw new Error("ROUTE_REFRESH_ELEMENT_BUDGET_EXCEEDED");
  }
  if(body?.production_worker_mutated!==false||body?.production_worker_traffic_changed!==false)throw new Error("ROUTE_REFRESH_WORKER_MUTATION_DENIED");
  if(body?.secrets_redacted!==true)throw new Error("ROUTE_REFRESH_REDACTION_REQUIRED");
  return body;
}
async function main(){const base=String(process.argv[2]||"").replace(/\/$/,""),probe=String(process.env.MAINTENANCE_E2E_PROBE_TOKEN||"");if(!base||!probe){console.error("EXPERT_ROUTE_REFRESH_E2E_FAILED:CONFIG_REQUIRED");process.exitCode=1;return}await sleep(INITIAL_SETTLE_MS);let last="NOT_ATTEMPTED";for(let i=1;i<=MAX_ATTEMPTS;i++){try{const{status,body}=await requestJson(`${base}/v1/maintenance/runtime-route-refresh`,probe);if(status!==200)last=`HTTP_${status}_${safe(body?.error_code)}`;else{const b=validate(body);console.log(JSON.stringify({ok:true,event:"EXPERT_ROUTE_SHARDS_RUNTIME_PASS",attempt:i,plan_digest:b.plan_digest,candidate_count:b.candidate_count,company_count:b.company_count,route_count:b.route_family.length,max_lanes_per_route:2,max_elements_per_route:16,source_status:b.source_status,model_id_pinning:false,future_models_auto_discover:true,secrets_redacted:true}));return}}catch(error){last=safe(error?.message||error)}if(i<MAX_ATTEMPTS)await sleep(RETRY_DELAY_MS)}console.error(`EXPERT_ROUTE_REFRESH_E2E_FAILED:${safe(last)}`);process.exitCode=1}
const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";if(import.meta.url===invoked)main().catch(()=>{console.error("EXPERT_ROUTE_REFRESH_E2E_FAILED:UNEXPECTED");process.exitCode=1});
