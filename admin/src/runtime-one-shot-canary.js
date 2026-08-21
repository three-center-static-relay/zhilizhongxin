import {handleLangGraphControl} from "./langgraph-control.js";

const TOKEN_SHA256="bd612a68b86c604226ee8491de92ab90e9dc8833f43eaff37cfac837ad1b77f2";
const EXPIRES_AT=Date.parse("2026-08-21T23:52:31.216Z");
const MAX_PROMPT_CHARS=12000;
const MAX_RESPONSE_BYTES=2*1024*1024;
const SOFT_POLICY=`Execution policy:\n- Prioritize price-performance: prefer sufficient reliability and capability at lower total cost/latency; escalate only when it materially improves correctness or robustness. No hard spending cap.\n- Control response length softly according to task complexity and information density. Do not use token limits.\n- Tools and web are forbidden.\n- Preserve material uncertainty, counterarguments, assumptions, and a clear final recommendation.`;

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function sha256(value){return hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value||""))))}
function constantTimeEqual(a,b){a=String(a||"");b=String(b||"");if(!a||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
async function authorized(request){if(Date.now()>EXPIRES_AT)return false;const supplied=request.headers.get("x-one-shot-token")||"";return constantTimeEqual(await sha256(supplied),TOKEN_SHA256)}
async function readJsonBounded(response){const declared=Number(response.headers.get("content-length")||0);if(declared>MAX_RESPONSE_BYTES)throw new Error("EXPERT_RESPONSE_TOO_LARGE");if(!response.body)return null;const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text="";while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_RESPONSE_BYTES){try{await reader.cancel()}catch{};throw new Error("EXPERT_RESPONSE_TOO_LARGE")}text+=decoder.decode(value,{stream:true})}text+=decoder.decode();return text?JSON.parse(text):null}

export async function handleRuntimeOneShotCanary(request,env){
  const url=new URL(request.url);
  if(request.method!=="POST"||url.pathname!=="/__runtime-canary/fuzhou-work-choice")return null;
  if(!(await authorized(request)))return json({ok:false,error:"NOT_FOUND"},404);
  let input;
  try{input=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},400)}
  const prompt=String(input?.prompt||"").trim();
  if(!prompt||prompt.length>MAX_PROMPT_CHARS)return json({ok:false,error:prompt?"PROMPT_TOO_LARGE":"PROMPT_REQUIRED"},prompt?413:400);
  const task={
    task_id:`runtime-fuzhou-choice-${crypto.randomUUID()}`,
    goal:`${prompt}\n\n${SOFT_POLICY}`,
    constraints:{allowed_centers:["governance","expert"],write_scope:"none",external_web:false,tools:false,production_mutation:false},
    risk:{max_trust_level:"T2",uncertainty:"medium"},
    budget:{cost_mode:"balanced",control:"soft-price-performance",hard_spend_cap:false,token_cap:false,length_control:"adaptive-soft"},
    required_capabilities:["governance.task-planner","expert.deliberation","expert.judgment"],
    deadline:new Date(Date.now()+10*60*1000).toISOString(),
    success_criteria:["LangGraph validates the plan","real expert deliberation completes","AI Gateway dynamic routing is used","no tools or web are used","no production mutation occurs"]
  };
  const laResponse=await handleLangGraphControl(new Request("https://admin.internal/v1/admin/langgraph/run",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(task)}),env);
  const la=laResponse?await laResponse.json().catch(()=>null):null;
  if(!laResponse?.ok||la?.ok!==true)return json({ok:false,stage:"langgraph-validation",langgraph_http_status:laResponse?.status||0,langgraph:la,secrets_redacted:true},laResponse?.status||502);
  if(!env.EXPERT_CENTER?.fetch)return json({ok:false,stage:"expert-execution",error:"EXPERT_SERVICE_BINDING_UNAVAILABLE",secrets_redacted:true},503);
  const expertRequest={task_id:`${task.task_id}-expert`,prompt,cost_priority:"balanced",cost_mode:"balanced",timeout_seconds:600,tools:false,web:false};
  const expertResponse=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/run",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(expertRequest)}));
  const expert=await readJsonBounded(expertResponse).catch(error=>({ok:false,error:String(error?.message||error)}));
  const ok=expertResponse.ok&&expert?.ok===true;
  return json({ok,selftest:"runtime-fuzhou-work-choice-v2",stage:ok?"completed":"expert-execution",langgraph:{ok:true,status:la?.status||null,runtime:la?.runtime||null,runtime_host:la?.runtime_host||null,control_plane:la?.control_plane||null,planner:la?.planner||null,brain_can_command:la?.brain_can_command===true,execution_mode:la?.execution_mode||null},policy:{cost_control:"soft-price-performance",length_control:"soft-adaptive",token_cap:false,tools:false,web:false},expert_http_status:expertResponse.status,expert,tools_used:false,web_used:false,production_mutation:false,secrets_redacted:true},ok?200:expertResponse.status||502);
}
