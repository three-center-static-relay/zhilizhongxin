#!/usr/bin/env node
import {request as httpsRequest} from "node:https";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const START_TIMEOUT_MS=600000,STATUS_TIMEOUT_MS=60000,POLL_MS=15000,MAX_POLLS=28;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const safe=v=>String(v??"UNKNOWN").replace(/[^0-9A-Za-z_.:/=-]/g,"_").slice(0,220);
const hex64=v=>/^[a-f0-9]{64}$/i.test(String(v||""));

function requestJson(url,probe,{method="GET",timeout=STATUS_TIMEOUT_MS}={}){
  return new Promise((resolvePromise,reject)=>{
    const u=new URL(url),req=httpsRequest({protocol:u.protocol,hostname:u.hostname,port:u.port||443,path:u.pathname+u.search,method,headers:{accept:"application/json","x-maintenance-e2e-probe":probe,...(method==="POST"?{"content-length":"0"}:{})}},res=>{
      let data="";res.setEncoding("utf8");res.on("data",chunk=>{data+=chunk;if(data.length>2_000_000)req.destroy(new Error("BODY_TOO_LARGE"))});res.on("end",()=>{let body=null;try{body=data?JSON.parse(data):null}catch{return reject(new Error("BAD_JSON"))}resolvePromise({status:res.statusCode||0,body})})
    });
    req.setTimeout(timeout,()=>req.destroy(new Error("TIMEOUT")));req.on("error",reject);req.end();
  });
}

function validateStart(status,body){
  if(status!==200||body?.ok!==true||body?.selftest!=="langgraph-complex-three-center-e2e-v1")throw new Error(`START_FAILED_${status}_${safe(body?.stage||body?.error)}`);
  const brain=body.brain||{};
  if(brain.ok!==true||brain.brain_can_command!==true||brain.langgraph_validated!==true||brain.tools_used!==false||brain.web_used!==false||brain.production_mutation!==false||!hex64(brain.plan_digest))throw new Error("BRAIN_COMMAND_FAILED");
  const expected=["governance","intelligence","compute","expert"];
  for(const center of expected){if(!brain.planned_centers?.includes(center))throw new Error(`CENTER_NOT_PLANNED_${center}`);if(!brain.dispatch_receipts?.some(r=>r?.center===center&&r?.ok===true&&Number(r?.http_status)===200))throw new Error(`CENTER_DISPATCH_FAILED_${center}`)}
  const intelligence=body.intelligence||{};
  if(intelligence.ok!==true||intelligence.http_status!==200||intelligence.provider!=="huggingface"||intelligence.operation!=="free_model_status"||intelligence.model_id!=="zai-org/GLM-4.7-Flash"||!hex64(intelligence.result_digest)||!intelligence.final_free_status||intelligence.final_free_status==="not_confirmed_free"||intelligence.paid_fallback_allowed!==false)throw new Error("INTELLIGENCE_REAL_TASK_FAILED");
  const expert=body.expert||{},receipts=Array.isArray(expert.provider_model_receipts)?expert.provider_model_receipts:[];
  if(expert.ok!==true||expert.http_status!==200||expert.company_diverse!==true||Number(expert.expert_count)<2||Number(expert.judge_count)<1||receipts.length<3||expert.route_family!=="expert-panel"||expert.route_registry_schema!=="expert-route-registry-v4.2-lane-pair"||!hex64(expert.output_digest)||expert.final_answer_nonempty!==true)throw new Error("EXPERT_COMPLEX_TASK_FAILED");
  const companies=new Set();for(const r of receipts){if(!r?.model||!r?.provider||!r?.company||!/^lanes-(1-2|3-4|5-6|7-8)$/.test(String(r?.route_shard||""))||!Number.isInteger(Number(r?.lane))||Number(r.lane)<1||Number(r.lane)>8)throw new Error("EXPERT_ROUTE_RECEIPT_INVALID");companies.add(String(r.company).toLowerCase())}if(companies.size!==receipts.length)throw new Error("EXPERT_COMPANY_DIVERSITY_FAILED");
  const compute=body.compute_start||{};if(compute.ok!==true||compute.http_status!==202||compute.op!=="matmul"||!compute.instance_id||!compute.task_id||compute.free_only!==true||compute.paid_fallback!==false||compute.arbitrary_code!==false||compute.workflow_payload_contains_task_values!==false)throw new Error("COMPUTE_START_FAILED");
  return body;
}

function sameMatrix(actual,expected){return Array.isArray(actual)&&actual.length===expected.length&&actual.every((row,i)=>Array.isArray(row)&&row.length===expected[i].length&&row.every((v,j)=>Number(v)===expected[i][j]))}
function validateCompute(body,taskId){
  if(body?.ok!==true||body?.lookup_ok!==true)return false;
  const state=String(body?.state||"").toLowerCase();if(!["complete","completed","success","succeeded"].includes(state))return false;
  const output=body?.output||{},receipt=output?.task_receipt||{};
  if(output.ok!==true||output.stage!=="task-completed"||output.task_id!==taskId||output.op!=="matmul"||output.resource_type!=="free"||output.task_secret_cleared!==true||output.gate_released!==true||output.free_only!==true||output.paid_fallback!==false)return false;
  if(receipt.ok!==true||receipt.task_id!==taskId||receipt.op!=="matmul"||!hex64(receipt.result_digest)||!sameMatrix(receipt.result,[[19,22],[43,50]]))return false;
  return true;
}

async function main(){
  const base=String(process.argv[2]||"").replace(/\/$/,""),probe=String(process.env.MAINTENANCE_E2E_PROBE_TOKEN||"");if(!base||!probe)throw new Error("CONFIG_REQUIRED");
  const start=await requestJson(`${base}/v1/maintenance/runtime-complex-system-e2e/start`,probe,{method:"POST",timeout:START_TIMEOUT_MS}),body=validateStart(start.status,start.body),compute=body.compute_start;
  let last=null;
  for(let i=1;i<=MAX_POLLS;i++){
    const r=await requestJson(`${base}/v1/maintenance/runtime-complex-system-e2e/compute-status?id=${encodeURIComponent(compute.instance_id)}&task_id=${encodeURIComponent(compute.task_id)}`,probe,{timeout:STATUS_TIMEOUT_MS});last=r.body;
    if(validateCompute(last,compute.task_id)){
      console.log(JSON.stringify({ok:true,event:"LANGGRAPH_COMPLEX_THREE_CENTER_E2E_PASS",brain_can_command:true,planned_centers:body.brain.planned_centers,intelligence:{provider:body.intelligence.provider,operation:body.intelligence.operation,final_free_status:body.intelligence.final_free_status,result_digest:body.intelligence.result_digest},expert:{expert_count:body.expert.expert_count,judge_count:body.expert.judge_count,rounds:body.expert.rounds,topology:body.expert.topology,cost_mode:body.expert.cost_mode,planner_source:body.expert.planner_source,planner_ai_route_used:body.expert.planner_ai_route_used,route_registry_schema:body.expert.route_registry_schema,provider_model_receipts:body.expert.provider_model_receipts,output_digest:body.expert.output_digest},compute:{op:"matmul",result:[[19,22],[43,50]],task_secret_cleared:true,gate_released:true,free_only:true},tools_used:false,web_used:false,production_mutation:false,secrets_redacted:true}));return;
    }
    const state=String(last?.state||"").toLowerCase();if(["errored","error","failed","terminated","cancelled","canceled"].includes(state))throw new Error(`COMPUTE_WORKFLOW_${safe(state)}_${safe(last?.error)}`);
    if(i<MAX_POLLS)await sleep(POLL_MS);
  }
  throw new Error(`COMPUTE_WORKFLOW_TIMEOUT_${safe(last?.state||"UNKNOWN")}`);
}

const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";if(import.meta.url===invoked)main().catch(error=>{console.error(`LANGGRAPH_COMPLEX_THREE_CENTER_E2E_FAILED:${safe(error?.message||error)}`);process.exitCode=1});
