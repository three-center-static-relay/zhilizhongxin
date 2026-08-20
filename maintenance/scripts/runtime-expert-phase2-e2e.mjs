#!/usr/bin/env node
import {request as httpsRequest} from "node:https";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const MAX_ATTEMPTS=2,INITIAL_SETTLE_MS=1500,RETRY_DELAY_MS=3000,REQUEST_TIMEOUT_MS=360000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function safe(v){return String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,180)}
function requestJson(url,probe){return new Promise((resolvePromise,reject)=>{const u=new URL(url),req=httpsRequest({protocol:u.protocol,hostname:u.hostname,port:u.port||443,path:u.pathname+u.search,method:"POST",headers:{accept:"application/json","content-length":"0","x-maintenance-e2e-probe":probe}},res=>{let data="";res.setEncoding("utf8");res.on("data",c=>{data+=c;if(data.length>524288)req.destroy(new Error("BODY_TOO_LARGE"))});res.on("end",()=>{let body=null;try{body=data?JSON.parse(data):null}catch{return reject(new Error("BAD_JSON"))}resolvePromise({status:res.statusCode||0,body})})});req.setTimeout(REQUEST_TIMEOUT_MS,()=>req.destroy(new Error("TIMEOUT")));req.on("error",reject);req.end()})}
function validate(body){
  if(body?.ok!==true)throw new Error(`PHASE2_NOT_OK_${safe(body?.error_code)}`);
  if(body?.selftest!=="maintenance-expert-v4.2-phase2-v1")throw new Error("PHASE2_VERSION_MISMATCH");
  if(body?.expert_http_status!==200)throw new Error("EXPERT_HTTP_200_REQUIRED");
  if(body?.route_family!=="expert-panel"||body?.route_registry_schema!=="expert-route-registry-v4.2-lane-pair"||body?.route_selection!=="global-lane-pair")throw new Error("LANE_PAIR_ROUTE_CONTRACT_REQUIRED");
  if(body?.legacy_route_used!==false)throw new Error("LEGACY_ROUTE_FORBIDDEN");
  if(body?.company_diverse!==true)throw new Error("COMPANY_DIVERSITY_REQUIRED");
  if(!Array.isArray(body?.provider_model_receipts)||body.provider_model_receipts.length<2)throw new Error("PROVIDER_MODEL_RECEIPTS_REQUIRED");
  const companies=new Set();for(const r of body.provider_model_receipts){if(!r?.model||!r?.provider||!r?.company||!r?.route_shard)throw new Error("RECEIPT_INCOMPLETE");if(!/^lanes-(1-2|3-4|5-6|7-8)$/.test(String(r.route_shard)))throw new Error("RECEIPT_SHARD_INVALID");if(!Number.isInteger(Number(r.lane))||Number(r.lane)<1||Number(r.lane)>8)throw new Error("RECEIPT_LANE_INVALID");companies.add(String(r.company).toLowerCase())}
  if(companies.size!==body.provider_model_receipts.length)throw new Error("RECEIPT_COMPANY_DUPLICATE");
  if(body?.content_scrubbed!==true||body?.secrets_redacted!==true||body?.tools_used!==false||body?.web_used!==false)throw new Error("PHASE2_ISOLATION_REQUIRED");
  if(body?.expert_worker_mutated!==false||body?.expert_business_traffic_changed!==false)throw new Error("EXPERT_MUTATION_FORBIDDEN");
  if(!/^[a-f0-9]{64}$/i.test(String(body?.output_digest||"")))throw new Error("OUTPUT_DIGEST_REQUIRED");
  if(body?.all_centers_connected_to_langgraph!==true||body?.brain_can_command!==true)throw new Error("LANGGRAPH_SYSTEM_COMMAND_REQUIRED");
  const brain=body?.langgraph_system_command||{};
  if(brain?.ok!==true||brain?.http_status!==200||brain?.runtime!=="@langchain/langgraph@1.4.10"||brain?.runtime_host!=="expert-worker"||brain?.control_plane!=="admin-worker"||brain?.planner!=="governance-worker")throw new Error("LANGGRAPH_RUNTIME_TOPOLOGY_REQUIRED");
  if(brain?.langgraph_validated!==true||brain?.model_invoked!==false||brain?.tools_used!==false||brain?.web_used!==false||brain?.brain_can_command!==true||brain?.production_mutation!==false)throw new Error("LANGGRAPH_COMMAND_POLICY_REQUIRED");
  const expected=["governance","intelligence","compute","expert"],planned=Array.isArray(brain?.planned_centers)?brain.planned_centers.map(String):[],receipts=Array.isArray(brain?.dispatch_receipts)?brain.dispatch_receipts:[];
  for(const center of expected){if(!planned.includes(center))throw new Error(`LANGGRAPH_CENTER_NOT_PLANNED_${center}`);if(!receipts.some(r=>String(r?.center||"")===center&&r?.ok===true&&Number(r?.http_status)===200))throw new Error(`LANGGRAPH_CENTER_DISPATCH_FAILED_${center}`)}
  if(!/^[a-f0-9]{64}$/i.test(String(brain?.plan_digest||"")))throw new Error("LANGGRAPH_PLAN_DIGEST_REQUIRED");
  return body;
}
async function main(){const base=String(process.argv[2]||"").replace(/\/$/,""),probe=String(process.env.MAINTENANCE_E2E_PROBE_TOKEN||"");if(!base||!probe){console.error("EXPERT_PHASE2_E2E_FAILED:CONFIG_REQUIRED");process.exitCode=1;return}await sleep(INITIAL_SETTLE_MS);let last="NOT_ATTEMPTED";for(let i=1;i<=MAX_ATTEMPTS;i++){try{const{status,body}=await requestJson(`${base}/v1/maintenance/runtime-expert-phase2`,probe);if(status!==200)last=`HTTP_${status}_${safe(body?.error_code)}`;else{const b=validate(body),brain=b.langgraph_system_command;console.log(JSON.stringify({ok:true,event:"EXPERT_V4_2_AND_LANGGRAPH_SYSTEM_RUNTIME_PASS",attempt:i,route_registry_schema:b.route_registry_schema,route_selection:b.route_selection,provider_model_receipt_count:b.provider_model_receipts.length,models:b.models,companies:b.companies,company_diverse:true,langgraph_runtime:brain.runtime,langgraph_runtime_host:brain.runtime_host,planned_centers:brain.planned_centers,dispatch_receipts:brain.dispatch_receipts,brain_can_command:true,all_centers_connected_to_langgraph:true,legacy_route_used:false,tools_used:false,web_used:false,content_scrubbed:true,secrets_redacted:true,output_digest:b.output_digest,plan_digest:brain.plan_digest}));return}}catch(error){last=safe(error?.message||error)}if(i<MAX_ATTEMPTS)await sleep(RETRY_DELAY_MS)}console.error(`EXPERT_PHASE2_E2E_FAILED:${safe(last)}`);process.exitCode=1}
const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";if(import.meta.url===invoked)main().catch(()=>{console.error("EXPERT_PHASE2_E2E_FAILED:UNEXPECTED");process.exitCode=1});
