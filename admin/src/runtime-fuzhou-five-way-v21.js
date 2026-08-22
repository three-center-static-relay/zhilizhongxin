import {handleLangGraphControl} from "./langgraph-control.js";

const EXPIRES_AT=Date.parse("2026-08-22T17:30:00.000Z");
const ENDPOINT="/__runtime-test/fuzhou-five-way-v21/R8mK3xT7vQ5sP2cN9hW1yF6dB0uGzA4eC7nL5jM3";
const DEPLOY_MARKER="fuzhou-five-way-expert-v21r3";
const CANARY_TASK_ID="fuzhou-five-way-v21-persisted";
const STALE_RUNNING_MS=10*60*1000;
const MAX_RESPONSE_BYTES=3*1024*1024;
const PROMPT=`在福州，开网约车、当保安、送快递、送外卖、送朴朴这五种工作，综合来看哪个更好？请从收入潜力、净收入与隐性成本、收入稳定性、工作时长、时间自由度、体力负荷、车辆/设备投入、安全与事故风险、平台规则和罚款风险、淡旺季波动、进入门槛、长期可持续性、职业发展空间、适合人群等维度进行系统比较。不要联网，不使用任何工具；如果缺少实时福州本地工资和单量数据，必须明确不确定性，不要编造当前实时数字。请区分“短期赚钱能力”和“长期综合性价比”，最后给出清晰综合排序，并说明不同类型的人分别适合哪一种。`;
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const clip=(value,n=12000)=>String(value??"").slice(0,n);

function state(env){return env.ADMIN_COORDINATOR.get(env.ADMIN_COORDINATOR.idFromName("global"))}
async function stateCall(env,path,method="GET",data){const init={method,headers:{"content-type":"application/json"}};if(data!==undefined)init.body=JSON.stringify(data);const r=await state(env).fetch(new Request(`https://state.internal${path}`,init));const body=await r.json().catch(()=>({ok:false,error:"STATE_BAD_RESPONSE"}));if(!r.ok)throw Object.assign(new Error(body.error||"STATE_ERROR"),{status:r.status,details:body});return body}

async function bounded(response){
  const declared=Number(response.headers.get("content-length")||0);
  if(declared>MAX_RESPONSE_BYTES)throw new Error("EXPERT_RESPONSE_TOO_LARGE");
  if(!response.body)return null;
  const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text="";
  while(true){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_RESPONSE_BYTES){try{await reader.cancel()}catch{}throw new Error("EXPERT_RESPONSE_TOO_LARGE")}text+=decoder.decode(value,{stream:true})}
  text+=decoder.decode();
  return text?JSON.parse(text):null;
}

async function expertContext(env){
  if(!env.EXPERT_CENTER?.fetch)return{ok:false,error:"EXPERT_SERVICE_BINDING_UNAVAILABLE"};
  const r=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/admin/context",{headers:{accept:"application/json"}})),b=await r.json().catch(()=>null);
  return{http_status:r.status,...(b||{ok:false,error:"EXPERT_CONTEXT_BAD_JSON"})};
}

function compact(result){
  const e=result?.expert||{};
  const rows=[...(Array.isArray(e.experts)?e.experts:[]),...(Array.isArray(e.judges)?e.judges:[])].map(x=>({role:x?.role||null,model:x?.model||null,provider:x?.provider||null,company:x?.company||null,lane:Number(x?.meta?.lane||0),content:clip(x?.content,6000)}));
  return{ok:result?.ok===true,http_status:Number(result?.http_status||0),selftest:result?.selftest||null,deploy_marker:result?.deploy_marker||null,stage:result?.stage||null,elapsed_ms:Number(result?.elapsed_ms||0),started_at:result?.started_at||null,finished_at:result?.finished_at||null,langgraph:result?.langgraph||null,request_profile:result?.request_profile||null,expert:{ok:e?.ok===true,status:e?.status||null,task_profile:e?.task_profile||null,expert_count:Number(e?.expert_count||0),judge_count:Number(e?.judge_count||0),company_diverse:e?.company_diverse===true,panel_plan:e?.panel_plan||null,rows,judge_content:clip(e?.judge?.content,16000),final_answer:clip(e?.final_answer,24000),output_digest:e?.output_digest||null,error:e?.error||e?.error_code||null},tools_used:false,web_used:false,production_mutation:false,secrets_redacted:true};
}

async function runOnce(env,attempt){
  const started_at=new Date().toISOString(),controlTaskId=`fuzhou-five-way-v21-control-${attempt}`,expertTaskId=`fuzhou-five-way-v21-expert-${attempt}`;
  const task={task_id:controlTaskId,goal:PROMPT,constraints:{allowed_centers:["governance","expert"],write_scope:"none",external_web:false,tools:false,production_mutation:false},risk:{max_trust_level:"T2",uncertainty:"medium"},budget:{cost_mode:"balanced",control:"soft-price-performance",hard_spend_cap:false,token_cap:false,length_control:"adaptive-soft"},required_capabilities:["governance.task-planner","expert.deliberation","expert.judgment"],deadline:new Date(Date.now()+10*60*1000).toISOString(),success_criteria:["LangGraph validates the task","Expert semantic profiling classifies business/comparison","multiple dynamic expert seats execute","AI Gateway Dynamic Routes select model/provider lanes","Judge produces final synthesis","tools and web remain disabled","no production mutation occurs"]};
  const lr=await handleLangGraphControl(new Request("https://admin.internal/v1/admin/langgraph/run",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(task)}),env),la=lr?await lr.json().catch(()=>null):null;
  if(!lr?.ok||la?.ok!==true)return{ok:false,http_status:lr?.status||502,selftest:"fuzhou-five-way-expert-v21",attempt,started_at,deploy_marker:DEPLOY_MARKER,stage:"langgraph-validation",langgraph:la,secrets_redacted:true};
  if(!env.EXPERT_CENTER?.fetch)return{ok:false,http_status:503,selftest:"fuzhou-five-way-expert-v21",attempt,started_at,deploy_marker:DEPLOY_MARKER,stage:"expert-execution",error:"EXPERT_SERVICE_BINDING_UNAVAILABLE",secrets_redacted:true};
  const started=Date.now();
  const er=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/run",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({task_id:expertTaskId,prompt:PROMPT,task_domain:"business",task_type:"comparison",complexity:"high",reasoning_depth:"deep",cost_mode:"balanced",model_count:2,rounds:1,timeout_seconds:420,tools:false,web:false})}));
  const expert=await bounded(er).catch(error=>({ok:false,error:String(error?.message||error)})),ok=er.ok&&expert?.ok===true;
  return{ok,http_status:ok?200:(er.status||502),selftest:"fuzhou-five-way-expert-v21",attempt,started_at,finished_at:new Date().toISOString(),deploy_marker:DEPLOY_MARKER,expert_task_id:expertTaskId,stage:ok?"completed":"expert-execution",elapsed_ms:Date.now()-started,request_profile:{model_count:2,rounds:1,cost_mode:"balanced",semantic_prompt_unmodified:true},langgraph:{ok:true,status:la?.status||null,runtime:la?.runtime||null,runtime_host:la?.runtime_host||null,control_plane:la?.control_plane||null,planner:la?.planner||null,brain_can_command:la?.brain_can_command===true,execution_mode:la?.execution_mode||null,plan_digest:la?.plan_digest||null,plan_path:la?.plan_path||null,planned_centers:la?.planned_centers||[]},expert_http_status:er.status,expert,tools_used:false,web_used:false,production_mutation:false,secrets_redacted:true};
}

export async function handleFuzhouFiveWayV21(request,env){
  const u=new URL(request.url);
  if(u.pathname!==ENDPOINT)return null;
  if(!["GET","POST"].includes(request.method)||Date.now()>EXPIRES_AT)return json({ok:false,error:"NOT_FOUND"},404);
  const operation=request.method==="GET"?(u.searchParams.get("operation")||"status"):"run";
  if(operation==="status"||operation==="result"){
    const stored=await stateCall(env,`/task/${encodeURIComponent(CANARY_TASK_ID)}`).catch(()=>({task:null}));
    return json({ok:true,selftest:"fuzhou-five-way-expert-v21",deploy_marker:DEPLOY_MARKER,persisted_task:stored.task||null,expert:operation==="status"?await expertContext(env):undefined,expires_at:new Date(EXPIRES_AT).toISOString(),secrets_redacted:true});
  }
  if(operation!=="run")return json({ok:false,error:"INVALID_OPERATION"},400);
  const stored=await stateCall(env,`/task/${encodeURIComponent(CANARY_TASK_ID)}`).catch(()=>({task:null}));
  let current=null;
  if(stored.task?.status==="running"){
    const started=Date.parse(stored.task?.started_at||"");
    const age=Number.isFinite(started)?Date.now()-started:Infinity;
    current=await expertContext(env);
    if(age<STALE_RUNNING_MS||current?.active_task)return json({ok:true,status:"running",attempt:stored.task?.attempt||null,age_ms:Number.isFinite(age)?age:null,active_task:Boolean(current?.active_task),deploy_marker:DEPLOY_MARKER,secrets_redacted:true},202);
    await stateCall(env,`/task/${encodeURIComponent(CANARY_TASK_ID)}`,"POST",{...stored.task,status:"stale-recovered",recovered_at:new Date().toISOString(),stale_age_ms:age,result:null}).catch(()=>{});
  }
  if(stored.task?.status==="completed"&&stored.task?.result?.ok===true)return json({ok:true,status:"completed",persisted:true,result:stored.task.result,deploy_marker:DEPLOY_MARKER,secrets_redacted:true},200);
  if(!current)current=await expertContext(env);
  if(current?.active_task)return json({ok:false,status:"busy",active_task:true,deploy_marker:DEPLOY_MARKER,secrets_redacted:true},409);
  const attempt=crypto.randomUUID();
  await stateCall(env,`/task/${encodeURIComponent(CANARY_TASK_ID)}`,"POST",{id:CANARY_TASK_ID,status:"running",attempt,started_at:new Date().toISOString(),result:null});
  try{
    const raw=await runOnce(env,attempt),result=compact(raw);
    await stateCall(env,`/task/${encodeURIComponent(CANARY_TASK_ID)}`,"POST",{id:CANARY_TASK_ID,status:"completed",attempt,started_at:result.started_at,finished_at:new Date().toISOString(),result});
    return json({ok:result.ok,status:"completed",persisted:true,result,deploy_marker:DEPLOY_MARKER,secrets_redacted:true},result.ok?200:(result.http_status||502));
  }catch(error){
    const result={ok:false,http_status:error?.status||500,selftest:"fuzhou-five-way-expert-v21",deploy_marker:DEPLOY_MARKER,stage:"canary",error:String(error?.message||error).slice(0,180),secrets_redacted:true};
    await stateCall(env,`/task/${encodeURIComponent(CANARY_TASK_ID)}`,"POST",{id:CANARY_TASK_ID,status:"completed",attempt,finished_at:new Date().toISOString(),result}).catch(()=>{});
    return json({ok:false,status:"completed",persisted:true,result,deploy_marker:DEPLOY_MARKER,secrets_redacted:true},result.http_status);
  }
}
