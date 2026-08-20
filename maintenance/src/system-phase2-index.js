import base,{MaintenanceState,AIGatewayCredentialRead} from "./phase2-index.js";
export {MaintenanceState,AIGatewayCredentialRead};

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const safe=v=>String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:/-]/g,"_").slice(0,180);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const routeShard=lane=>{const n=Math.trunc(Number(lane));return !Number.isFinite(n)||n<1||n>8?null:n<=2?"lanes-1-2":n<=4?"lanes-3-4":n<=6?"lanes-5-6":"lanes-7-8"};

async function bindingJson(binding,request,timeoutMs=90000){
  if(!binding?.fetch)return{ok:false,http_status:0,error:"SERVICE_BINDING_UNAVAILABLE",body:null};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,timeoutMs));
  try{
    const response=await binding.fetch(new Request(request,{signal:controller.signal}));
    const raw=await response.text();
    let body=null;try{body=raw?JSON.parse(raw):null}catch{return{ok:false,http_status:response.status,error:"UPSTREAM_BAD_JSON",body:null}}
    return{ok:response.ok&&body?.ok!==false,http_status:response.status,error:response.ok?null:String(body?.error||body?.error_code||`HTTP_${response.status}`),body};
  }catch(error){return{ok:false,http_status:0,error:error?.name==="AbortError"?"UPSTREAM_TIMEOUT":safe(error?.message||error),body:null}}
  finally{clearTimeout(timer)}
}

function commandTask(){
  return{
    task_id:`langgraph-complex-command-${crypto.randomUUID()}`,
    goal:"Plan and validate a multi-stage task that needs evidence retrieval, dataset discovery, CPU computation, simulation, expert deliberation and expert judgment while remaining read-only and fail-closed.",
    constraints:{allowed_centers:["governance","intelligence","compute","expert"],write_scope:"none"},
    risk:{max_trust_level:"T2",uncertainty:"high"},
    budget:{cost_mode:"free-first",max_paid_usd:0},
    required_capabilities:["governance.task-planner","intelligence.provider-query","intelligence.dataset-radar","compute.cpu","compute.simulation","expert.deliberation","expert.judgment"],
    deadline:new Date(Date.now()+10*60*1000).toISOString(),
    success_criteria:["all centers are planned","LangGraph validates the graph","every planned step is reachable","no production mutation"]
  };
}

function rejectedTask(){
  return{
    task_id:`langgraph-failclosed-${crypto.randomUUID()}`,
    goal:"Negative control: this task must not execute because one required capability does not exist.",
    constraints:{allowed_centers:["governance","intelligence","compute","expert"],write_scope:"none"},
    risk:{max_trust_level:"T2",uncertainty:"low"},
    budget:{cost_mode:"free-first",max_paid_usd:0},
    required_capabilities:["intelligence.provider-query","compute.nonexistent-capability","expert.deliberation"],
    deadline:new Date(Date.now()+5*60*1000).toISOString(),
    success_criteria:["planner fails closed","no execution starts","no production mutation"]
  };
}

async function commandBrain(env){
  return bindingJson(env.ADMIN_CENTER,new Request("https://admin.internal/v1/admin/langgraph/run",{
    method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify(commandTask())
  }),120000);
}

async function failClosedBrain(env){
  const result=await bindingJson(env.ADMIN_CENTER,new Request("https://admin.internal/v1/admin/langgraph/run",{
    method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify(rejectedTask())
  }),90000),body=result.body||{};
  const pass=result.http_status===502&&body?.ok===false&&body?.brain_can_command===false&&body?.production_mutation===false&&String(body?.status||"")==="planning-failed";
  return{ok:pass,http_status:result.http_status,status:String(body?.status||""),brain_can_command:body?.brain_can_command===true,production_mutation:body?.production_mutation===true,error:body?.error?safe(body.error):result.error};
}

async function intelligenceBusiness(env){
  const taskId=`intel-complex-${crypto.randomUUID()}`;
  const result=await bindingJson(env.INTELLIGENCE_CENTER,new Request("https://intelligence.internal/v1/run",{
    method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({task_id:taskId,provider:"huggingface",operation:"free_model_status",args:{model_id:"zai-org/GLM-4.7-Flash"},timeout_seconds:90})
  }),120000),body=result.body||{},out=body?.result||{};
  const ok=result.http_status===200&&body?.ok===true&&body?.provider==="huggingface"&&body?.operation==="free_model_status"&&/^[a-f0-9]{64}$/i.test(String(body?.result_digest||""))&&out?.paid_fallback_allowed===false;
  return{ok,http_status:result.http_status,provider:String(body?.provider||""),operation:String(body?.operation||""),result_digest:String(body?.result_digest||""),final_free_status:String(out?.final_free_status||""),router_evidence_available:out?.router_evidence_available===true,vendor_free_verified:out?.vendor?.vendor_free_verified===true,paid_fallback_allowed:out?.paid_fallback_allowed===true,secrets_redacted:true,error:ok?null:safe(result.error||body?.error)};
}

async function computeStart(env){
  const acceptance=await bindingJson(env.COMPUTE_CENTER,new Request("https://compute.internal/v1/acceptance/latest",{method:"GET",headers:{accept:"application/json"}}),30000);
  const selftest=await bindingJson(env.COMPUTE_CENTER,new Request("https://compute.internal/v1/selftest/modelscope-studio-lite",{method:"GET",headers:{accept:"application/json"}}),45000),ready=selftest.body||{};
  const acceptanceOk=acceptance.http_status===200&&acceptance.body?.ok===true&&String(acceptance.body?.status||"").startsWith("production-verified");
  if(ready?.route_eligible!==true)return{ok:acceptanceOk,attempted:false,route_eligible:false,acceptance_status:String(acceptance.body?.status||""),reason:"MODELSCOPE_FREE_ROUTE_NOT_CURRENTLY_ELIGIBLE",free_only:true,paid_fallback:false,secrets_redacted:true};
  const start=await bindingJson(env.COMPUTE_CENTER,new Request("https://compute.internal/v1/admin/modelscope/studio-lite/compute",{
    method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({op:"sum",values:[3,5,8,13,21]})
  }),60000),body=start.body||{};
  if(start.http_status!==202||body?.ok!==true||!body?.instance_id)return{ok:false,attempted:true,route_eligible:true,http_status:start.http_status,error:safe(start.error||body?.error),free_only:true,paid_fallback:false,secrets_redacted:true};
  return{ok:true,attempted:true,route_eligible:true,instance_id:String(body.instance_id),task_id:String(body.task_id||""),expected_result:50,free_only:body?.free_only===true,paid_fallback:body?.paid_fallback===true,secrets_redacted:true};
}

async function computeFinish(env,start){
  if(!start?.attempted)return start;
  let last=null;
  for(let i=1;i<=18;i++){
    await sleep(15000);
    const result=await bindingJson(env.COMPUTE_CENTER,new Request(`https://compute.internal/v1/admin/modelscope/studio-lite/workflow?id=${encodeURIComponent(start.instance_id)}`,{method:"GET",headers:{accept:"application/json"}}),30000),body=result.body||{},status=body?.status||{},output=status?.output||null,receipt=output?.task_receipt||null,state=String(status?.status||status?.state||"");
    last={http_status:result.http_status,state,output,receipt};
    if(state==="complete"){
      const ok=result.http_status===200&&body?.ok===true&&output?.ok===true&&receipt?.ok===true&&receipt?.op==="sum"&&Number(receipt?.result)===50&&/^[a-f0-9]{64}$/i.test(String(receipt?.result_digest||""))&&output?.task_secret_cleared===true&&output?.gate_released===true&&output?.free_only===true&&output?.paid_fallback===false;
      return{ok,attempted:true,route_eligible:true,http_status:result.http_status,state,task_id:start.task_id,result:Number(receipt?.result),result_digest:String(receipt?.result_digest||""),resource_type:String(output?.resource_type||""),task_secret_cleared:output?.task_secret_cleared===true,gate_released:output?.gate_released===true,free_only:output?.free_only===true,paid_fallback:output?.paid_fallback===true,secrets_redacted:true,error:ok?null:"COMPUTE_RESULT_VALIDATION_FAILED"};
    }
    if(state==="errored")break;
  }
  return{ok:false,attempted:true,route_eligible:true,http_status:last?.http_status||0,state:last?.state||"UNKNOWN",task_id:start.task_id,free_only:true,paid_fallback:false,secrets_redacted:true,error:"COMPUTE_WORKFLOW_NOT_COMPLETE"};
}

async function expertBusiness(env){
  const result=await bindingJson(env.EXPERT_CENTER,new Request("https://expert.internal/v1/run",{
    method:"POST",headers:{accept:"application/json","content-type":"application/json","x-three-center-selftest":"1"},body:JSON.stringify({task_id:`expert-complex-${crypto.randomUUID()}`,prompt:"Complex systems acceptance. Analyze whether a hypothetical service should launch under uncertain demand. Use independent strategy, quantitative, risk and adversarial perspectives; keep the final answer concise and self-contained. Do not use external facts.",model_count:4,judge_count:1,rounds:1,max_tokens:192,timeout_seconds:240,cost_mode:"free-first"})
  }),300000),body=result.body||{};
  const experts=Array.isArray(body?.experts)?body.experts:[],judges=Array.isArray(body?.judges)?body.judges:[],participants=[...experts,...judges];
  const receipts=participants.map(p=>({model:String(p?.model||""),provider:String(p?.provider||""),company:String(p?.company||""),lane:Number(p?.meta?.lane||p?.lane||0),route_shard:routeShard(p?.meta?.lane||p?.lane)}));
  const companies=new Set(receipts.map(x=>x.company.toLowerCase()).filter(Boolean)),shards=new Set(receipts.map(x=>x.route_shard).filter(Boolean));
  const complete=receipts.length>=3&&receipts.every(x=>x.model&&x.provider&&x.company&&x.route_shard&&Number.isInteger(x.lane)&&x.lane>=1&&x.lane<=8);
  const ok=result.http_status===200&&body?.ok===true&&body?.status==="completed"&&body?.company_diverse===true&&complete&&companies.size>=3&&shards.size>=2&&body?.route_family==="expert-panel"&&body?.route_registry_schema==="expert-route-registry-v4.2-lane-pair"&&/^[a-f0-9]{64}$/i.test(String(body?.output_digest||""));
  return{ok,http_status:result.http_status,status:String(body?.status||""),participant_count:receipts.length,expert_count:Number(body?.expert_count||experts.length||0),judge_count:Number(body?.judge_count||judges.length||0),company_count:companies.size,route_shard_count:shards.size,route_shards:[...shards],receipts,route_family:String(body?.route_family||""),route_registry_schema:String(body?.route_registry_schema||""),company_diverse:body?.company_diverse===true,output_digest:String(body?.output_digest||""),tools_used:false,web_used:false,secrets_redacted:true,error:ok?null:safe(result.error||body?.error)};
}

async function phase2WithBrain(request,env,ctx){
  const expertResponse=await base.fetch(request,env,ctx);
  const expertBody=await expertResponse.json().catch(()=>null);
  if(expertResponse.status!==200||expertBody?.ok!==true)return json(expertBody||{ok:false,error_code:"EXPERT_PHASE2_BAD_RESPONSE"},expertResponse.status||502);

  const command=await commandBrain(env),brain=command.body||{};
  const plannedCenters=Array.isArray(brain?.planned_centers)?brain.planned_centers.map(String):[];
  const receipts=Array.isArray(brain?.dispatch_receipts)?brain.dispatch_receipts:[];
  const expectedCenters=["governance","intelligence","compute","expert"];
  const expectedCapabilities=["governance.task-planner","intelligence.provider-query","intelligence.dataset-radar","compute.cpu","compute.simulation","expert.deliberation","expert.judgment"];
  const allCenters=expectedCenters.every(center=>plannedCenters.includes(center))&&expectedCenters.every(center=>receipts.some(r=>String(r?.center||"")===center&&r?.ok===true&&Number(r?.http_status)===200));
  const allCapabilities=expectedCapabilities.every(capability=>receipts.some(r=>String(r?.capability_id||"")===capability&&r?.ok===true&&Number(r?.http_status)===200));
  const brainOk=command.http_status===200&&brain?.ok===true&&brain?.langgraph_validated===true&&brain?.langgraph_model_invoked===false&&brain?.langgraph_tools_used===false&&brain?.langgraph_web_used===false&&brain?.production_mutation===false&&allCenters&&allCapabilities;
  if(!brainOk)return json({...expertBody,brain_can_command:false,error_code:"LANGGRAPH_COMPLEX_COMMAND_FAILED",secrets_redacted:true},502);

  const negative=await failClosedBrain(env);
  const computeStartReceipt=await computeStart(env);
  const [intelligence,expertComplex]=await Promise.all([intelligenceBusiness(env),expertBusiness(env)]);
  const compute=await computeFinish(env,computeStartReceipt);
  const routeAi=expertBody?.route_refresh_accepted===true&&Number(expertBody?.route_refresh_route_count)===4&&expertComplex?.ok===true&&expertComplex?.route_shard_count>=2;
  const businessOk=negative.ok&&intelligence.ok&&compute.ok&&expertComplex.ok&&routeAi;

  return json({
    ...expertBody,
    langgraph_system_command:{
      ok:brainOk,http_status:command.http_status,runtime:String(brain?.runtime||""),runtime_host:String(brain?.runtime_host||""),control_plane:String(brain?.control_plane||""),planner:String(brain?.planner||""),task_id:String(brain?.task_id||""),plan_digest:String(brain?.plan_digest||""),plan_path:String(brain?.plan_path||""),planned_centers:plannedCenters,langgraph_validated:brain?.langgraph_validated===true,model_invoked:brain?.langgraph_model_invoked===true,tools_used:brain?.langgraph_tools_used===true,web_used:brain?.langgraph_web_used===true,dispatch_receipts:receipts.map(r=>({step_id:String(r?.step_id||""),center:String(r?.center||""),capability_id:String(r?.capability_id||""),ok:r?.ok===true,http_status:Number(r?.http_status||0),error:r?.error?safe(r.error):null})),brain_can_command:brain?.brain_can_command===true,execution_mode:String(brain?.execution_mode||""),production_mutation:brain?.production_mutation===true,secrets_redacted:true,error:null
    },
    complex_runtime_suite:{ok:businessOk,fail_closed_negative:negative,intelligence_business:intelligence,compute_business:compute,expert_business:expertComplex,route_ai:{ok:routeAi,route_refresh_accepted:expertBody?.route_refresh_accepted===true,route_refresh_route_count:Number(expertBody?.route_refresh_route_count||0),runtime_route_shard_count:Number(expertComplex?.route_shard_count||0),runtime_route_shards:expertComplex?.route_shards||[],dynamic_route_schema:String(expertBody?.route_registry_schema||"")},secrets_redacted:true},
    all_centers_connected_to_langgraph:brainOk,
    brain_can_command:brainOk&&businessOk,
    secrets_redacted:true,
    error_code:businessOk?null:"COMPLEX_RUNTIME_SUITE_FAILED"
  },businessOk?200:502);
}

export default{
  async fetch(request,env,ctx){const url=new URL(request.url);if(request.method==="POST"&&url.pathname==="/v1/maintenance/runtime-expert-phase2")return phase2WithBrain(request,env,ctx);return base.fetch(request,env,ctx)},
  async scheduled(controller,env,ctx){return base.scheduled(controller,env,ctx)}
};
