import {handleLangGraphControl} from "./langgraph-control.js";

const TOKEN_SHA256="3ad785dd08110289b4c0fa6414e49989449f8ddcbf06ed9152c5d6d530f47f51";
const EXPIRES_AT=Date.parse("2026-08-22T00:50:00.000Z");
const MAX_PROMPT_CHARS=12000;
const MAX_RESPONSE_BYTES=2*1024*1024;
const SOFT_POLICY=`Execution policy:\n- Prioritize price-performance dynamically according to task complexity; no hard spending cap.\n- Control response length softly according to task complexity and information density. Do not use token limits.\n- Tools and web are forbidden.\n- Preserve material uncertainty, counterarguments, assumptions, and a clear final recommendation.`;

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function sha256(value){return hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value||""))))}
function constantTimeEqual(a,b){a=String(a||"");b=String(b||"");if(!a||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
async function authorized(request){if(Date.now()>EXPIRES_AT)return false;const supplied=request.headers.get("x-one-shot-token")||"";return constantTimeEqual(await sha256(supplied),TOKEN_SHA256)}
function state(env){return env.ADMIN_COORDINATOR.get(env.ADMIN_COORDINATOR.idFromName("global"))}
async function stateCall(env,path,method="GET",data){const init={method,headers:{"content-type":"application/json"}};if(data!==undefined)init.body=JSON.stringify(data);const r=await state(env).fetch(new Request(`https://state.internal${path}`,init));const body=await r.json().catch(()=>({ok:false,error:"STATE_BAD_RESPONSE"}));if(!r.ok)throw Object.assign(new Error(body.error||"STATE_ERROR"),{status:r.status,details:body});return body}
async function release(env,owner){try{await stateCall(env,"/lock/release","POST",{owner})}catch{}}
async function readJsonBounded(response){const declared=Number(response.headers.get("content-length")||0);if(declared>MAX_RESPONSE_BYTES)throw new Error("EXPERT_RESPONSE_TOO_LARGE");if(!response.body)return null;const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text="";while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_RESPONSE_BYTES){try{await reader.cancel()}catch{};throw new Error("EXPERT_RESPONSE_TOO_LARGE")}text+=decoder.decode(value,{stream:true})}text+=decoder.decode();return text?JSON.parse(text):null}
async function expertContext(env){if(!env.EXPERT_CENTER?.fetch)return{ok:false,error:"EXPERT_SERVICE_BINDING_UNAVAILABLE"};const r=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/admin/context",{headers:{accept:"application/json"}})),body=await r.json().catch(()=>null);return{ok:r.ok&&body?.ok===true,http_status:r.status,active_task:body?.active_task||null,runtime_version:body?.runtime_version||null,health:body?.health||null}}

async function runOnce(input,env,requestId){
  const prompt=String(input?.prompt||"").trim();
  const task={task_id:`runtime-adaptive-${requestId}`,goal:`${prompt}\n\n${SOFT_POLICY}`,constraints:{allowed_centers:["governance","expert"],write_scope:"none",external_web:false,tools:false,production_mutation:false},risk:{max_trust_level:"T2",uncertainty:"medium"},budget:{cost_mode:"balanced",control:"soft-price-performance",hard_spend_cap:false,token_cap:false,length_control:"adaptive-soft"},required_capabilities:["governance.task-planner","expert.deliberation","expert.judgment"],deadline:new Date(Date.now()+10*60*1000).toISOString(),success_criteria:["LangGraph validates the plan","semantic task profiling completes","panel organization is dynamic","AI Gateway dynamic routing is used","final Judge or Synthesis produces the final answer","no hidden reasoning is exposed","no tools or web are used","no production mutation occurs"]};
  const laResponse=await handleLangGraphControl(new Request("https://admin.internal/v1/admin/langgraph/run",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(task)}),env),la=laResponse?await laResponse.json().catch(()=>null):null;
  if(!laResponse?.ok||la?.ok!==true)return{ok:false,http_status:laResponse?.status||502,stage:"langgraph-validation",langgraph_http_status:laResponse?.status||0,langgraph:la,secrets_redacted:true};
  if(!env.EXPERT_CENTER?.fetch)return{ok:false,http_status:503,stage:"expert-execution",error:"EXPERT_SERVICE_BINDING_UNAVAILABLE",secrets_redacted:true};
  const expertRequest={task_id:`${task.task_id}-expert`,prompt,tools:false,web:false};
  const expertResponse=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/run",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(expertRequest)})),expert=await readJsonBounded(expertResponse).catch(error=>({ok:false,error:String(error?.message||error)})),ok=expertResponse.ok&&expert?.ok===true;
  return{ok,http_status:ok?200:(expertResponse.status||502),selftest:"runtime-adaptive-expert-v4",stage:ok?"completed":"expert-execution",langgraph:{ok:true,status:la?.status||null,runtime:la?.runtime||null,runtime_host:la?.runtime_host||null,control_plane:la?.control_plane||null,planner:la?.planner||null,brain_can_command:la?.brain_can_command===true,execution_mode:la?.execution_mode||null},policy:{cost_control:"dynamic-soft-price-performance",length_control:"soft-adaptive",token_cap:false,tools:false,web:false},expert_http_status:expertResponse.status,expert,tools_used:false,web_used:false,production_mutation:false,secrets_redacted:true};
}

export async function handleRuntimeOneShotCanary(request,env){
  const url=new URL(request.url),base="/__runtime-canary/adaptive-expert";
  if(!url.pathname.startsWith(base))return null;
  if(!(await authorized(request)))return json({ok:false,error:"NOT_FOUND"},404);
  if(request.method==="GET"&&url.pathname===`${base}/status`)return json({ok:true,expert:await expertContext(env),expires_at:new Date(EXPIRES_AT).toISOString(),secrets_redacted:true});
  if(request.method==="GET"&&url.pathname===`${base}/result`){const requestId=String(url.searchParams.get("id")||"").replace(/[^0-9A-Za-z._:-]/g,"_").slice(0,160);if(!requestId)return json({ok:false,error:"REQUEST_ID_REQUIRED"},400);const stored=await stateCall(env,`/task/${encodeURIComponent(`runtime-canary-${requestId}`)}`).catch(()=>({task:null}));return json({ok:true,request_id:requestId,task:stored.task||null,secrets_redacted:true});}
  if(request.method!=="POST"||url.pathname!==base)return json({ok:false,error:"NOT_FOUND"},404);
  let input;try{input=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},400)}
  const prompt=String(input?.prompt||"").trim();if(!prompt||prompt.length>MAX_PROMPT_CHARS)return json({ok:false,error:prompt?"PROMPT_TOO_LARGE":"PROMPT_REQUIRED"},prompt?413:400);
  const requestId=String(input?.request_id||"adaptive-effect-v4").replace(/[^0-9A-Za-z._:-]/g,"_").slice(0,160),taskKey=`runtime-canary-${requestId}`,owner=`runtime-canary:${requestId}`;
  const existing=await stateCall(env,`/task/${encodeURIComponent(taskKey)}`).catch(()=>({task:null}));if(existing.task?.status==="completed")return json(existing.task.result,existing.task.result?.http_status||200);if(existing.task?.status==="running")return json({ok:true,status:"running",request_id:requestId,reused:true,secrets_redacted:true},202);
  try{await stateCall(env,"/lock/acquire","POST",{owner,kind:"runtime-canary",ttl_seconds:900})}catch{return json({ok:true,status:"running",request_id:requestId,reused:true,secrets_redacted:true},202)}
  try{await stateCall(env,`/task/${encodeURIComponent(taskKey)}`,"POST",{id:taskKey,status:"running",started_at:new Date().toISOString()});const result=await runOnce(input,env,requestId);const retryable=result?.expert_http_status===409&&result?.expert?.error==="BUSY";await stateCall(env,`/task/${encodeURIComponent(taskKey)}`,"POST",{id:taskKey,status:retryable?"retryable":"completed",result,finished_at:new Date().toISOString()});return json(result,result.http_status||500)}finally{await release(env,owner)}
}
