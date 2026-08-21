import {handleLangGraphControl} from "./langgraph-control.js";

const PATH="/v1/admin/langgraph/canary/fuzhou-work-choice-20260822";
const NONCE="27cf2ec98db8ad04f5ed36b23e3ce09c";
const MAX_RESPONSE_BYTES=2*1024*1024;
const CACHE_TTL_SECONDS=3600;
const PROMPT=`在福州市工作，在“送外卖、送快递、开网约车、当保安”四种选择中，哪个综合最优？请作为多专家决策委员会真实讨论并给出排序。必须比较：税前/净收入潜力、收入稳定性、工时、劳动强度、交通事故与职业风险、车辆/设备投入和折旧、平台算法与订单波动、社保福利、进入门槛、长期可持续性、可转型空间，以及“短期多赚钱”和“长期稳妥”两种目标。不要联网，不要使用工具，不要虚构具体实时工资数字；对于缺少实时数据的地方明确说明不确定性。最终必须给出1-4名排序、每项核心理由、什么条件下排序会改变，以及一句话最终建议。`;

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const safe=v=>String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:/-]/g,"_").slice(0,180);

async function readJsonBounded(response){
  const declared=Number(response.headers.get("content-length")||0);
  if(declared>MAX_RESPONSE_BYTES)throw Object.assign(new Error("EXPERT_RESPONSE_TOO_LARGE"),{status:502});
  if(!response.body)return null;
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let bytes=0,text="";
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    bytes+=value.byteLength;
    if(bytes>MAX_RESPONSE_BYTES){try{await reader.cancel()}catch{};throw Object.assign(new Error("EXPERT_RESPONSE_TOO_LARGE"),{status:502})}
    text+=decoder.decode(value,{stream:true});
  }
  text+=decoder.decode();
  try{return text?JSON.parse(text):null}catch{throw Object.assign(new Error("EXPERT_BAD_JSON"),{status:502})}
}

function task(){
  return {
    task_id:`langgraph-fuzhou-work-${crypto.randomUUID()}`,
    goal:PROMPT,
    constraints:{allowed_centers:["governance","expert"],write_scope:"none",external_web:false,tools:false,production_mutation:false},
    risk:{max_trust_level:"T2",uncertainty:"medium"},
    budget:{cost_mode:"free-first",max_paid_usd:0},
    required_capabilities:["governance.task-planner","expert.deliberation","expert.judgment"],
    deadline:new Date(Date.now()+10*60*1000).toISOString(),
    success_criteria:["LangGraph validates the plan","real expert panel executes","no tools or web are used","no production mutation occurs"]
  };
}

async function validateWithLangGraph(env,supervisorTask){
  const request=new Request("https://admin.internal/v1/admin/langgraph/run",{
    method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(supervisorTask)
  });
  const response=await handleLangGraphControl(request,env);
  if(!response)return {ok:false,http_status:500,body:null,error:"LANGGRAPH_CONTROL_UNAVAILABLE"};
  const body=await response.json().catch(()=>null);
  return {ok:response.ok&&body?.ok===true,http_status:response.status,body,error:body?.error||null};
}

async function executeExpert(env,taskId){
  if(!env.EXPERT_CENTER?.fetch)return {ok:false,http_status:0,body:null,error:"EXPERT_SERVICE_BINDING_UNAVAILABLE"};
  const response=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/run",{
    method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({
      task_id:`${taskId}-expert`,prompt:PROMPT,task_domain:"business",task_type:"decision",complexity:"high",reasoning_depth:"deep",cost_priority:"economy",model_count:4,rounds:1,max_tokens:768,timeout_seconds:300,cost_mode:"free-first"
    })
  }));
  const body=await readJsonBounded(response);
  return {ok:response.ok&&body?.ok===true,http_status:response.status,body,error:body?.error||body?.error_code||null};
}

async function run(env){
  const supervisorTask=task();
  const la=await validateWithLangGraph(env,supervisorTask);
  if(!la.ok)return {ok:false,selftest:"langgraph-fuzhou-work-choice-v1",stage:"langgraph-validation",error:la.error||"LANGGRAPH_VALIDATION_FAILED",langgraph:la.body,expert_executed:false,tools_used:false,web_used:false,production_mutation:false,secrets_redacted:true};
  const expert=await executeExpert(env,supervisorTask.task_id);
  return {
    ok:expert.ok===true,selftest:"langgraph-fuzhou-work-choice-v1",stage:expert.ok?"completed":"expert-execution",error:expert.ok?null:(expert.error||"EXPERT_EXECUTION_FAILED"),
    langgraph:{ok:true,status:la.body?.status||null,runtime:la.body?.runtime||null,runtime_host:la.body?.runtime_host||null,control_plane:la.body?.control_plane||null,planner:la.body?.planner||null,plan_digest:la.body?.plan_digest||null,planned_centers:la.body?.planned_centers||[],brain_can_command:la.body?.brain_can_command===true,execution_mode:la.body?.execution_mode||null},
    expert_http_status:expert.http_status,expert:expert.body,expert_executed:true,service_binding_dispatch:true,tools_used:false,web_used:false,production_mutation:false,secrets_redacted:true
  };
}

export async function handleFuzhouWorkCanary(request,env){
  const url=new URL(request.url);
  if(request.method!=="GET"||url.pathname!==PATH)return null;
  if(url.searchParams.get("nonce")!==NONCE)return new Response(null,{status:404,headers:{"cache-control":"no-store"}});
  const cacheKey=new Request(`${url.origin}${PATH}?nonce=${NONCE}&receipt=1`,{method:"GET"});
  try{
    const cached=await caches.default.match(cacheKey);
    if(cached)return cached;
    const result=await run(env),status=result.ok?200:502;
    const response=Response.json(result,{status,headers:{"cache-control":`public, max-age=${CACHE_TTL_SECONDS}`}});
    if(result.ok)await caches.default.put(cacheKey,response.clone());
    return response;
  }catch(error){return json({ok:false,selftest:"langgraph-fuzhou-work-choice-v1",stage:"failed",error:safe(error?.message||error),expert_executed:false,tools_used:false,web_used:false,production_mutation:false,secrets_redacted:true},error?.status||500)}
}
