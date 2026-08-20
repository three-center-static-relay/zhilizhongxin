const MAX_RESPONSE_BYTES=1500000;
const EXPECTED_CENTERS=["governance","intelligence","compute","expert"];
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const safe=v=>String(v??"UNKNOWN").replace(/[^0-9A-Za-z_.:/-]/g,"_").slice(0,180);
const hex64=v=>/^[a-f0-9]{64}$/i.test(String(v||""));
const routeShard=lane=>{const n=Math.trunc(Number(lane));if(!Number.isFinite(n)||n<1||n>8)return null;return n<=2?"lanes-1-2":n<=4?"lanes-3-4":n<=6?"lanes-5-6":"lanes-7-8"};

function authorized(request,env){
  const expected=String(env.MAINTENANCE_RUNTIME_E2E_PROBE||""),supplied=String(request.headers.get("x-maintenance-e2e-probe")||"");
  if(!expected||expected.length!==supplied.length||String(env.MAINTENANCE_COMPLEX_E2E_PROBE||"")!=="1")return false;
  let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);return diff===0;
}

async function bindingJson(binding,request,timeoutMs=60000){
  if(!binding?.fetch)return{ok:false,http_status:0,error:"SERVICE_BINDING_UNAVAILABLE",body:null};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,timeoutMs));
  try{
    const response=await binding.fetch(new Request(request,{signal:controller.signal}));
    const raw=await response.text();
    if(new TextEncoder().encode(raw).length>MAX_RESPONSE_BYTES)return{ok:false,http_status:response.status,error:"UPSTREAM_BODY_TOO_LARGE",body:null};
    let body=null;try{body=raw?JSON.parse(raw):null}catch{return{ok:false,http_status:response.status,error:"UPSTREAM_BAD_JSON",body:null}}
    return{ok:response.ok&&body?.ok!==false,http_status:response.status,error:response.ok?null:String(body?.error||body?.error_code||`HTTP_${response.status}`),body};
  }catch(error){return{ok:false,http_status:0,error:error?.name==="AbortError"?"UPSTREAM_TIMEOUT":safe(error?.message||error),body:null}}
  finally{clearTimeout(timer)}
}

function brainTask(){
  return{
    task_id:`complex-e2e-${crypto.randomUUID()}`,
    goal:"Plan a real three-center verification: retrieve current model-source evidence, perform bounded numerical computation, and obtain independent multi-model expert adjudication. The planner must include Intelligence, Compute and Expert while Governance remains the planner.",
    constraints:{allowed_centers:["governance","intelligence","compute","expert"],write_scope:"none"},
    risk:{max_trust_level:"T2",uncertainty:"high"},
    budget:{cost_mode:"free-first",max_paid_usd:0},
    required_capabilities:["governance.task-planner","intelligence.provider-query","compute.cpu","expert.deliberation"],
    deadline:new Date(Date.now()+12*60*1000).toISOString(),
    success_criteria:["fresh intelligence result is returned","bounded computation completes with a deterministic result","at least three company-diverse expert participants return through AI Gateway Dynamic Routes","all three centers remain fail-closed"]
  };
}

async function runBrain(env){
  const result=await bindingJson(env.ADMIN_CENTER,new Request("https://admin.internal/v1/admin/langgraph/run",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify(brainTask())}),90000),body=result.body||{};
  const planned=Array.isArray(body.planned_centers)?body.planned_centers.map(String):[],receipts=Array.isArray(body.dispatch_receipts)?body.dispatch_receipts:[];
  const centersOk=EXPECTED_CENTERS.every(center=>planned.includes(center)&&receipts.some(r=>String(r?.center||"")===center&&r?.ok===true&&Number(r?.http_status)===200));
  const ok=result.ok&&result.http_status===200&&body.ok===true&&body.brain_can_command===true&&body.langgraph_validated===true&&body.langgraph_model_invoked===false&&body.langgraph_tools_used===false&&body.langgraph_web_used===false&&body.production_mutation===false&&centersOk&&hex64(body.plan_digest);
  return{ok,http_status:result.http_status,error:ok?null:safe(result.error||body.error||"LANGGRAPH_COMPLEX_PLAN_FAILED"),runtime:String(body.runtime||""),runtime_host:String(body.runtime_host||""),control_plane:String(body.control_plane||""),planner:String(body.planner||""),plan_digest:String(body.plan_digest||""),planned_centers:planned,dispatch_receipts:receipts.map(r=>({center:String(r?.center||""),capability_id:String(r?.capability_id||""),ok:r?.ok===true,http_status:Number(r?.http_status||0),error:r?.error?safe(r.error):null})),brain_can_command:body.brain_can_command===true,langgraph_validated:body.langgraph_validated===true,tools_used:body.langgraph_tools_used===true,web_used:body.langgraph_web_used===true,production_mutation:body.production_mutation===true};
}

async function runIntelligence(env){
  const taskId=`complex-intel-${crypto.randomUUID()}`;
  const result=await bindingJson(env.INTELLIGENCE_CENTER,new Request("https://intelligence.internal/v1/run",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({task_id:taskId,provider:"huggingface",operation:"free_model_status",args:{model_id:"zai-org/GLM-4.7-Flash"},timeout_seconds:90})}),120000),body=result.body||{},payload=body.result||{};
  const status=String(payload.final_free_status||"");
  const ok=result.ok&&result.http_status===200&&body.ok===true&&body.provider==="huggingface"&&body.operation==="free_model_status"&&hex64(body.result_digest)&&payload.model_id==="zai-org/GLM-4.7-Flash"&&Boolean(status)&&status!=="not_confirmed_free"&&payload.paid_fallback_allowed===false;
  return{ok,http_status:result.http_status,error:ok?null:safe(result.error||body.error||"INTELLIGENCE_REAL_TASK_FAILED"),task_id:taskId,provider:String(body.provider||""),operation:String(body.operation||""),result_digest:String(body.result_digest||""),model_id:String(payload.model_id||""),final_free_status:status,recommended_access:String(payload.recommended_access||""),router_evidence_available:payload.router_evidence_available===true,vendor_free_verified:payload.vendor?.vendor_free_verified===true,paid_fallback_allowed:payload.paid_fallback_allowed===true};
}

async function runExpert(env){
  const taskId=`complex-expert-${crypto.randomUUID()}`;
  const prompt="Complex production orchestration test. Evaluate this claim: a bounded system that combines fresh external evidence, deterministic computation, and independent multi-model review is more reliable than any one component alone. Identify at least three failure modes, distinguish correlation from causal support, verify the arithmetic statement 17*19=323, and finish with a calibrated accept/reject judgment. Use multiple independent expert roles and at least one judge. Do not use tools or web.";
  const result=await bindingJson(env.EXPERT_CENTER,new Request("https://expert.internal/v1/run",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({task_id:taskId,prompt,model_count:4,max_tokens:512,timeout_seconds:420,cost_mode:"free-first"})}),480000),body=result.body||{};
  const experts=Array.isArray(body.experts)?body.experts:[],judges=Array.isArray(body.judges)?body.judges:[],participants=[...experts,...judges];
  const receipts=participants.map(p=>({model:String(p?.model||""),provider:String(p?.provider||""),company:String(p?.company||""),lane:Number(p?.meta?.lane||p?.lane||0),route_shard:routeShard(p?.meta?.lane||p?.lane),stage:String(p?.meta?.stage||"")}));
  const companies=receipts.map(r=>r.company.toLowerCase()).filter(Boolean),uniqueCompanies=new Set(companies),plannerSource=String(body?.panel_plan?.planner_source||"");
  const routesOk=receipts.length>=3&&receipts.every(r=>r.model&&r.provider&&r.company&&Number.isInteger(r.lane)&&r.lane>=1&&r.lane<=8&&Boolean(r.route_shard));
  const ok=result.ok&&result.http_status===200&&body.ok===true&&body.status==="completed"&&body.company_diverse===true&&Number(body.expert_count)>=2&&Number(body.judge_count)>=1&&participants.length===Number(body.expert_count||0)+Number(body.judge_count||0)&&uniqueCompanies.size===receipts.length&&routesOk&&body.route_family==="expert-panel"&&body.route_registry_schema==="expert-route-registry-v4.2-lane-pair"&&hex64(body.output_digest)&&typeof body.final_answer==="string"&&body.final_answer.trim().length>0;
  return{ok,http_status:result.http_status,error:ok?null:safe(result.error||body.error||"EXPERT_COMPLEX_TASK_FAILED"),task_id:taskId,expert_count:Number(body.expert_count||0),judge_count:Number(body.judge_count||0),rounds:Number(body.rounds||0),topology:String(body.topology||""),cost_mode:String(body.cost_mode||""),planner_source:plannerSource,planner_ai_route_used:plannerSource==="cloudflare-panel-architect",route_family:String(body.route_family||""),route_registry_schema:String(body.route_registry_schema||""),provider_model_receipts:receipts,companies:[...uniqueCompanies],company_diverse:body.company_diverse===true,output_digest:String(body.output_digest||""),final_answer_nonempty:typeof body.final_answer==="string"&&body.final_answer.trim().length>0,tools_used:false,web_used:false};
}

async function startCompute(env){
  const statusResult=await bindingJson(env.COMPUTE_CENTER,new Request("https://compute.internal/v1/admin/modelscope/studio-lite/status",{method:"GET",headers:{accept:"application/json"}}),45000),status=statusResult.body||{};
  if(!statusResult.ok||status.route_eligible!==true)return{ok:false,http_status:statusResult.http_status,error:safe(statusResult.error||status.error_class||"MODELSCOPE_STUDIO_LITE_NOT_READY"),route_eligible:false};
  const result=await bindingJson(env.COMPUTE_CENTER,new Request("https://compute.internal/v1/admin/modelscope/studio-lite/compute",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({op:"matmul",a:[[1,2],[3,4]],b:[[5,6],[7,8]]})}),60000),body=result.body||{};
  const ok=result.ok&&result.http_status===202&&body.ok===true&&body.op==="matmul"&&Boolean(body.instance_id)&&Boolean(body.task_id)&&body.free_only===true&&body.paid_fallback===false&&body.arbitrary_code===false&&body.workflow_payload_contains_task_values===false;
  return{ok,http_status:result.http_status,error:ok?null:safe(result.error||body.error||"COMPUTE_WORKFLOW_START_FAILED"),task_id:String(body.task_id||""),instance_id:String(body.instance_id||""),op:String(body.op||""),free_only:body.free_only===true,paid_fallback:body.paid_fallback===true,arbitrary_code:body.arbitrary_code===true,workflow_payload_contains_task_values:body.workflow_payload_contains_task_values===true};
}

function sanitizeWorkflowStatus(body){
  const s=body?.status&&typeof body.status==="object"?body.status:{},output=s?.output&&typeof s.output==="object"?s.output:null,receipt=output?.task_receipt&&typeof output.task_receipt==="object"?output.task_receipt:null;
  return{ok:body?.ok===true,state:String(s?.status||""),error:s?.error?safe(typeof s.error==="string"?s.error:JSON.stringify(s.error)):null,output:output?{ok:output.ok===true,stage:String(output.stage||""),task_id:String(output.task_id||""),op:String(output.op||""),target_hardware:String(output.target_hardware||""),resource_type:String(output.resource_type||""),task_secret_cleared:output.task_secret_cleared===true,gate_released:output.gate_released===true,free_only:output.free_only===true,paid_fallback:output.paid_fallback===true,task_receipt:receipt?{ok:receipt.ok===true,revision:String(receipt.revision||""),task_id:String(receipt.task_id||""),op:String(receipt.op||""),result:receipt.result??null,result_digest:String(receipt.result_digest||""),error_class:receipt.error_class?safe(receipt.error_class):null}:null}:null};
}

async function computeStatus(request,env){
  const url=new URL(request.url),id=String(url.searchParams.get("id")||""),taskId=String(url.searchParams.get("task_id")||"");
  if(!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/.test(id)||!/^[A-Za-z0-9_][A-Za-z0-9_-]{5,99}$/.test(taskId))return json({ok:false,error:"INVALID_COMPUTE_STATUS_ID"},400);
  const result=await bindingJson(env.COMPUTE_CENTER,new Request(`https://compute.internal/v1/admin/modelscope/studio-lite/workflow?id=${encodeURIComponent(id)}`,{method:"GET",headers:{accept:"application/json"}}),45000);
  const status=sanitizeWorkflowStatus(result.body||{});return json({...status,http_status:result.http_status,lookup_ok:result.ok,task_id:taskId,secrets_redacted:true},result.ok?200:502);
}

async function start(env){
  const brain=await runBrain(env);if(!brain.ok)return json({ok:false,stage:"brain",brain,secrets_redacted:true},502);
  const intelligence=await runIntelligence(env);if(!intelligence.ok)return json({ok:false,stage:"intelligence",brain,intelligence,secrets_redacted:true},502);
  const expert=await runExpert(env);if(!expert.ok)return json({ok:false,stage:"expert",brain,intelligence,expert,secrets_redacted:true},502);
  const compute_start=await startCompute(env);if(!compute_start.ok)return json({ok:false,stage:"compute-start",brain,intelligence,expert,compute_start,secrets_redacted:true},502);
  return json({ok:true,selftest:"langgraph-complex-three-center-e2e-v1",brain,intelligence,expert,compute_start,all_real_tasks_started:true,production_mutation:false,secrets_redacted:true});
}

export default{async fetch(request,env){const url=new URL(request.url);if(!authorized(request,env))return json({ok:false,error:"NOT_FOUND"},404);if(request.method==="POST"&&url.pathname==="/v1/maintenance/runtime-complex-system-e2e/start")return start(env);if(request.method==="GET"&&url.pathname==="/v1/maintenance/runtime-complex-system-e2e/compute-status")return computeStatus(request,env);return json({ok:false,error:"NOT_FOUND"},404)}};
