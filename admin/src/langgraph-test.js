import {handleLangGraphControl} from "./langgraph-control.js";

const MAX_BODY_BYTES=65536;
const MAX_PROMPT_CHARS=12000;
const MAX_EXPERT_RESPONSE_BYTES=2*1024*1024;
const SOFT_POLICY=`Execution policy:\n- Prioritize price-performance: prefer sufficient reliability and capability at lower total cost/latency; escalate to stronger or more expensive models only when it materially improves correctness, robustness, or decision quality. No hard spending cap.\n- Control response length softly according to task complexity and information density. Avoid unnecessary repetition, but do not truncate material reasoning, caveats, or conclusions merely to save tokens or cost. Do not use token limits as a quality or cost-control mechanism.\n- Tools are forbidden: no tools, functions, browser, web search, external retrieval, code execution, or external actions.\n- Preserve material uncertainty, counterarguments, and assumptions.`;
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const safe=v=>String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:/-]/g,"_").slice(0,180);
const int=(v,d)=>{const n=Number(v);return Number.isFinite(n)?Math.trunc(n):d};
const clamp=(v,lo,hi,d)=>Math.max(lo,Math.min(hi,int(v,d)));

function constantTimeEqual(a,b){
  a=String(a||"");
  b=String(b||"");
  if(!a||a.length!==b.length)return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}

function bearerToken(request){
  const header=request.headers.get("authorization")||"";
  return header.startsWith("Bearer ")?header.slice(7).trim():"";
}

function authorize(request,env){
  const expected=String(env?.ADMIN_GPT_TOKEN||"");
  if(!expected)return {ok:false,status:503,error:"ADMIN_TOKEN_NOT_CONFIGURED"};
  if(!constantTimeEqual(bearerToken(request),expected))return {ok:false,status:401,error:"UNAUTHORIZED"};
  return {ok:true};
}

async function strictJson(request){
  const declared=Number(request.headers.get("content-length")||0);
  if(declared>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  let body;
  try{body=raw?JSON.parse(raw):null}catch{throw Object.assign(new Error("INVALID_JSON"),{status:400})}
  if(!body||typeof body!=="object"||Array.isArray(body))throw Object.assign(new Error("INVALID_JSON"),{status:400});
  const prompt=String(body.prompt||"").trim();
  if(!prompt)throw Object.assign(new Error("PROMPT_REQUIRED"),{status:400});
  if(prompt.length>MAX_PROMPT_CHARS)throw Object.assign(new Error("PROMPT_TOO_LARGE"),{status:413});
  return {...body,prompt};
}

async function readJsonBounded(response){
  const declared=Number(response.headers.get("content-length")||0);
  if(declared>MAX_EXPERT_RESPONSE_BYTES)throw Object.assign(new Error("EXPERT_RESPONSE_TOO_LARGE"),{status:502});
  if(!response.body)return null;
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let bytes=0,text="";
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    bytes+=value.byteLength;
    if(bytes>MAX_EXPERT_RESPONSE_BYTES){try{await reader.cancel()}catch{};throw Object.assign(new Error("EXPERT_RESPONSE_TOO_LARGE"),{status:502})}
    text+=decoder.decode(value,{stream:true});
  }
  text+=decoder.decode();
  try{return text?JSON.parse(text):null}catch{throw Object.assign(new Error("EXPERT_BAD_JSON"),{status:502})}
}

function softGoal(prompt){return `${prompt}\n\n${SOFT_POLICY}`}

function supervisorTask(input){
  return {
    task_id:`langgraph-user-test-${crypto.randomUUID()}`,
    goal:softGoal(input.prompt),
    constraints:{
      allowed_centers:["governance","expert"],
      write_scope:"none",
      external_web:false,
      tools:false,
      production_mutation:false
    },
    risk:{max_trust_level:"T2",uncertainty:String(input.uncertainty||"medium").slice(0,32)},
    budget:{cost_mode:"balanced",control:"soft-price-performance",hard_spend_cap:false,token_cap:false,length_control:"adaptive-soft"},
    required_capabilities:["governance.task-planner","expert.deliberation","expert.judgment"],
    deadline:new Date(Date.now()+10*60*1000).toISOString(),
    success_criteria:[
      "LangGraph validates the plan",
      "expert center is reachable through a service binding",
      "a real multi-expert analysis completes",
      "price-performance is preferred without a hard spending cap",
      "answer length is controlled softly without a token cap",
      "no tools or web are used",
      "no production mutation occurs"
    ]
  };
}

function expertRequest(input,taskId){
  const out={
    task_id:`${taskId}-expert`,
    prompt:input.prompt,
    cost_priority:String(input.cost_priority||"balanced").slice(0,32),
    cost_mode:String(input.cost_mode||"balanced").slice(0,32),
    timeout_seconds:clamp(input.timeout_seconds,60,600,300),
    tools:false,
    web:false
  };
  if(input.task_domain!=null)out.task_domain=String(input.task_domain).slice(0,64);
  if(input.task_type!=null)out.task_type=String(input.task_type).slice(0,64);
  if(input.complexity!=null)out.complexity=String(input.complexity).slice(0,32);
  if(input.reasoning_depth!=null)out.reasoning_depth=String(input.reasoning_depth).slice(0,32);
  if(input.model_count!=null)out.model_count=clamp(input.model_count,2,8,4);
  if(input.rounds!=null)out.rounds=clamp(input.rounds,1,3,1);
  return out;
}

async function validateWithLangGraph(input,env){
  const task=supervisorTask(input);
  const request=new Request("https://admin.internal/v1/admin/langgraph/run",{
    method:"POST",
    headers:{"content-type":"application/json",accept:"application/json"},
    body:JSON.stringify(task)
  });
  const response=await handleLangGraphControl(request,env);
  if(!response)return {ok:false,http_status:500,body:null,error:"LANGGRAPH_CONTROL_UNAVAILABLE",task};
  const body=await response.json().catch(()=>null);
  return {ok:response.ok&&body?.ok===true,http_status:response.status,body,error:body?.error||null,task};
}

async function executeExpert(input,task,env){
  if(!env.EXPERT_CENTER?.fetch)return {ok:false,http_status:0,body:null,error:"EXPERT_SERVICE_BINDING_UNAVAILABLE"};
  const response=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/run",{
    method:"POST",
    headers:{"content-type":"application/json",accept:"application/json"},
    body:JSON.stringify(expertRequest(input,task.task_id))
  }));
  const body=await readJsonBounded(response);
  return {ok:response.ok&&body?.ok===true,http_status:response.status,body,error:body?.error||body?.error_code||null};
}

export async function handleLangGraphTest(request,env){
  const url=new URL(request.url);
  if(request.method!=="POST"||url.pathname!=="/v1/admin/langgraph/test")return null;
  const auth=authorize(request,env);
  if(!auth.ok)return json({ok:false,error:auth.error,secrets_redacted:true},auth.status);
  try{
    const input=await strictJson(request);
    const la=await validateWithLangGraph(input,env);
    if(!la.ok)return json({
      ok:false,
      selftest:"langgraph-expert-business-test-v1",
      stage:"langgraph-validation",
      error:la.error||"LANGGRAPH_VALIDATION_FAILED",
      langgraph:la.body,
      expert_executed:false,
      public_test_entrypoint:true,
      internal_workers_publicly_exposed:false,
      production_mutation:false,
      secrets_redacted:true
    },la.http_status||502);

    const expert=await executeExpert(input,la.task,env);
    const ok=expert.ok===true;
    return json({
      ok,
      selftest:"langgraph-expert-business-test-v1",
      stage:ok?"completed":"expert-execution",
      error:ok?null:(expert.error||"EXPERT_EXECUTION_FAILED"),
      langgraph:{
        ok:true,
        status:la.body?.status||null,
        runtime:la.body?.runtime||null,
        runtime_host:la.body?.runtime_host||null,
        control_plane:la.body?.control_plane||null,
        planner:la.body?.planner||null,
        plan_digest:la.body?.plan_digest||null,
        planned_centers:la.body?.planned_centers||[],
        brain_can_command:la.body?.brain_can_command===true,
        execution_mode:la.body?.execution_mode||null
      },
      policy:{cost_control:"soft-price-performance",length_control:"soft-adaptive",token_cap:false,tools:false,web:false},
      expert_http_status:expert.http_status,
      expert:expert.body,
      expert_executed:true,
      service_binding_dispatch:true,
      public_test_entrypoint:true,
      public_auth:"ADMIN_GPT_TOKEN",
      internal_workers_publicly_exposed:false,
      tools_used:false,
      web_used:false,
      production_mutation:false,
      secrets_redacted:true
    },ok?200:(expert.http_status||502));
  }catch(error){
    return json({
      ok:false,
      selftest:"langgraph-expert-business-test-v1",
      stage:"failed",
      error:safe(error?.message||error),
      expert_executed:false,
      public_test_entrypoint:true,
      internal_workers_publicly_exposed:false,
      production_mutation:false,
      secrets_redacted:true
    },error?.status||500);
  }
}
