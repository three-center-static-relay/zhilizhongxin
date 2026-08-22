import {handleLangGraphControl} from "./langgraph-control.js";

const TOKEN_SHA256="42b6d885ae008fc044256891469026a443d9ef85f9e577ffd48cb0015c6333b1";
const EXPIRES_AT=Date.parse("2026-08-22T03:05:00.000Z");
const ENDPOINT="/__runtime-canary/adaptive-rerun-v6";
const EXPERT_TASK_ID="runtime-adaptive-rerun-v6-expert";
const MAX_RESPONSE_BYTES=2*1024*1024;
const PROMPT=`请比较在福州从事以下几种工作的综合优劣：外卖骑手、快递员、网约车司机、朴朴配送员、保安。请根据具体问题具体分析，重点比较收入潜力、收入稳定性、时间自由度、体力负荷、车辆和设备成本、安全及事故风险、平台规则风险、长期可持续性、进入门槛和综合性价比。不要联网，不使用任何工具；如果缺乏实时本地数据，必须明确不确定性，不要编造当前工资数字。最后给出清晰的综合排序，并分别说明什么类型的人更适合哪一种。`;
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function sha256(value){return hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value||""))))}
function constantTimeEqual(a,b){a=String(a||"");b=String(b||"");if(!a||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
async function authorized(input){if(Date.now()>EXPIRES_AT)return false;return constantTimeEqual(await sha256(input?.token||""),TOKEN_SHA256)}
async function readJsonBounded(response){const declared=Number(response.headers.get("content-length")||0);if(declared>MAX_RESPONSE_BYTES)throw new Error("EXPERT_RESPONSE_TOO_LARGE");if(!response.body)return null;const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text="";while(true){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_RESPONSE_BYTES){try{await reader.cancel()}catch{};throw new Error("EXPERT_RESPONSE_TOO_LARGE")}text+=decoder.decode(value,{stream:true})}text+=decoder.decode();return text?JSON.parse(text):null}
async function expertStatus(env){if(!env.EXPERT_CENTER?.fetch)return{ok:false,error:"EXPERT_SERVICE_BINDING_UNAVAILABLE"};const r=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/status",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({task_id:EXPERT_TASK_ID})}));const body=await r.json().catch(()=>null);return{http_status:r.status,...(body||{ok:false,error:"EXPERT_STATUS_BAD_JSON"})}}
async function runOnce(env){
  const task={task_id:"runtime-canary-adaptive-rerun-v6-control",goal:PROMPT,constraints:{allowed_centers:["governance","expert"],write_scope:"none",external_web:false,tools:false,production_mutation:false},risk:{max_trust_level:"T2",uncertainty:"medium"},budget:{cost_mode:"balanced",control:"soft-price-performance",hard_spend_cap:false,token_cap:false,length_control:"adaptive-soft"},required_capabilities:["governance.task-planner","expert.deliberation","expert.judgment"],deadline:new Date(Date.now()+10*60*1000).toISOString(),success_criteria:["LangGraph validates the task","semantic profiling is appropriate for an occupational comparison","panel organization is dynamically adapted","AI Gateway Dynamic Routes select models/providers","a Judge or final synthesis produces the user-facing final answer","tools and web remain disabled","no production mutation occurs"]};
  const laResponse=await handleLangGraphControl(new Request("https://admin.internal/v1/admin/langgraph/run",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(task)}),env);
  const la=laResponse?await laResponse.json().catch(()=>null):null;
  if(!laResponse?.ok||la?.ok!==true)return{ok:false,http_status:laResponse?.status||502,stage:"langgraph-validation",langgraph:la,secrets_redacted:true};
  if(!env.EXPERT_CENTER?.fetch)return{ok:false,http_status:503,stage:"expert-execution",error:"EXPERT_SERVICE_BINDING_UNAVAILABLE",secrets_redacted:true};
  const expertRequest={task_id:EXPERT_TASK_ID,prompt:PROMPT,tools:false,web:false};
  const started=Date.now();
  const expertResponse=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/run",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(expertRequest)}));
  const expert=await readJsonBounded(expertResponse).catch(error=>({ok:false,error:String(error?.message||error)}));
  const ok=expertResponse.ok&&expert?.ok===true;
  return{ok,http_status:ok?200:(expertResponse.status||502),selftest:"runtime-adaptive-rerun-v6",stage:ok?"completed":"expert-execution",elapsed_ms:Date.now()-started,langgraph:{ok:true,status:la?.status||null,runtime:la?.runtime||null,runtime_host:la?.runtime_host||null,control_plane:la?.control_plane||null,planner:la?.planner||null,brain_can_command:la?.brain_can_command===true,execution_mode:la?.execution_mode||null},expert_http_status:expertResponse.status,expert,tools_used:false,web_used:false,production_mutation:false,secrets_redacted:true};
}
export async function handleRuntimeAdaptiveRerunV6(request,env){
  const url=new URL(request.url);if(url.pathname!==ENDPOINT)return null;if(request.method!=="POST")return json({ok:false,error:"NOT_FOUND"},404);
  let input;try{input=await request.json()}catch{return json({ok:false,error:"NOT_FOUND"},404)}
  if(!(await authorized(input)))return json({ok:false,error:"NOT_FOUND"},404);
  if(input?.operation==="status")return json({ok:true,expert:await expertStatus(env),expires_at:new Date(EXPIRES_AT).toISOString(),secrets_redacted:true});
  if(input?.operation!=="run")return json({ok:false,error:"INVALID_OPERATION"},400);
  const result=await runOnce(env);return json(result,result.http_status||500);
}
