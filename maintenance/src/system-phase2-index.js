import base,{MaintenanceState,AIGatewayCredentialRead} from "./phase2-index.js";
export {MaintenanceState,AIGatewayCredentialRead};

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const safe=v=>String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:/-]/g,"_").slice(0,180);

function commandTask(){
  return{
    task_id:`langgraph-system-command-${crypto.randomUUID()}`,
    goal:"Verify that the shared LangGraph brain can plan, validate and command the governance, intelligence, compute and expert centers through Cloudflare Service Bindings.",
    constraints:{allowed_centers:["governance","intelligence","compute","expert"],write_scope:"none"},
    risk:{max_trust_level:"T2",uncertainty:"low"},
    budget:{cost_mode:"free-first",max_paid_usd:0},
    required_capabilities:["governance.task-planner","intelligence.provider-query","compute.cpu","expert.deliberation"],
    deadline:new Date(Date.now()+5*60*1000).toISOString(),
    success_criteria:["all four centers are reachable","LangGraph validates the cross-center plan","dispatch receipts succeed without tools or web access"]
  };
}

async function commandBrain(env){
  if(!env.ADMIN_CENTER?.fetch)return{ok:false,http_status:0,body:{ok:false,error:"ADMIN_CENTER_UNBOUND"}};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  try{
    const response=await env.ADMIN_CENTER.fetch(new Request("https://admin.internal/v1/admin/langgraph/run",{
      method:"POST",
      headers:{accept:"application/json","content-type":"application/json"},
      body:JSON.stringify(commandTask()),
      signal:controller.signal
    }));
    const body=await response.json().catch(()=>null);
    return{ok:response.status===200&&body?.ok===true&&body?.brain_can_command===true,http_status:response.status,body};
  }catch(error){return{ok:false,http_status:0,body:{ok:false,error:error?.name==="AbortError"?"LANGGRAPH_COMMAND_TIMEOUT":safe(error?.message||error)}}}
  finally{clearTimeout(timer)}
}

async function phase2WithBrain(request,env,ctx){
  const expertResponse=await base.fetch(request,env,ctx);
  const expertBody=await expertResponse.json().catch(()=>null);
  if(expertResponse.status!==200||expertBody?.ok!==true)return json(expertBody||{ok:false,error_code:"EXPERT_PHASE2_BAD_RESPONSE"},expertResponse.status||502);

  const command=await commandBrain(env),brain=command.body||{};
  const plannedCenters=Array.isArray(brain?.planned_centers)?brain.planned_centers.map(String):[];
  const receipts=Array.isArray(brain?.dispatch_receipts)?brain.dispatch_receipts:[];
  const expectedCenters=["governance","intelligence","compute","expert"];
  const allCenters=expectedCenters.every(center=>plannedCenters.includes(center))&&expectedCenters.every(center=>receipts.some(r=>String(r?.center||"")===center&&r?.ok===true));
  const brainOk=command.ok
    && brain?.langgraph_validated===true
    && brain?.langgraph_model_invoked===false
    && brain?.langgraph_tools_used===false
    && brain?.langgraph_web_used===false
    && brain?.production_mutation===false
    && allCenters;

  return json({
    ...expertBody,
    langgraph_system_command:{
      ok:brainOk,
      http_status:command.http_status,
      runtime:String(brain?.runtime||""),
      runtime_host:String(brain?.runtime_host||""),
      control_plane:String(brain?.control_plane||""),
      planner:String(brain?.planner||""),
      task_id:String(brain?.task_id||""),
      plan_digest:String(brain?.plan_digest||""),
      plan_path:String(brain?.plan_path||""),
      planned_centers:plannedCenters,
      langgraph_validated:brain?.langgraph_validated===true,
      model_invoked:brain?.langgraph_model_invoked===true,
      tools_used:brain?.langgraph_tools_used===true,
      web_used:brain?.langgraph_web_used===true,
      dispatch_receipts:receipts.map(r=>({step_id:String(r?.step_id||""),center:String(r?.center||""),capability_id:String(r?.capability_id||""),ok:r?.ok===true,http_status:Number(r?.http_status||0),error:r?.error?safe(r.error):null})),
      brain_can_command:brain?.brain_can_command===true,
      execution_mode:String(brain?.execution_mode||""),
      production_mutation:brain?.production_mutation===true,
      secrets_redacted:true,
      error:brainOk?null:safe(brain?.error||"LANGGRAPH_SYSTEM_COMMAND_FAILED")
    },
    all_centers_connected_to_langgraph:brainOk,
    brain_can_command:brainOk,
    secrets_redacted:true,
    error_code:brainOk?null:"LANGGRAPH_SYSTEM_COMMAND_FAILED"
  },brainOk?200:502);
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="POST"&&url.pathname==="/v1/maintenance/runtime-expert-phase2")return phase2WithBrain(request,env,ctx);
    return base.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx){return base.scheduled(controller,env,ctx)}
};
