const MAX_BODY_BYTES=65536;
const MAX_RESPONSE_BYTES=524288;
const DEFAULT_TIMEOUT_MS=15000;
const BRAIN_TIMEOUT_MS=60000;
const ALLOWED_CENTERS=new Set(["governance","intelligence","compute","expert"]);
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

const CENTER_PROBES={
  governance:{binding:"GOVERNANCE_CENTER",url:"https://governance.internal/v1/evolution/kernel"},
  intelligence:{binding:"INTELLIGENCE_CENTER",url:"https://intelligence.internal/v1/capabilities"},
  compute:{binding:"COMPUTE_CENTER",url:"https://compute.internal/v1/capabilities"},
  expert:{binding:"EXPERT_CENTER",url:"https://expert.internal/v1/capabilities"}
};

function constantTimeEqual(a,b){a=String(a||"");b=String(b||"");if(!a||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
function safe(v){return String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:/-]/g,"_").slice(0,180)}
function internalOnly(url){return url.hostname==="admin.internal"}
function uniq(values){return[...new Set(values)]}

async function strictJson(request){
  const declared=Number(request.headers.get("content-length")||0);
  if(declared>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  if(!raw)throw Object.assign(new Error("INVALID_REQUEST"),{status:400});
  try{const body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();return body}catch{throw Object.assign(new Error("INVALID_REQUEST"),{status:400})}
}

async function bindingJson(binding,request,timeoutMs=DEFAULT_TIMEOUT_MS){
  if(!binding?.fetch)return{ok:false,http_status:0,error:"SERVICE_BINDING_UNAVAILABLE",body:null};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,timeoutMs));
  try{
    const response=await binding.fetch(new Request(request,{signal:controller.signal}));
    const declared=Number(response.headers.get("content-length")||0);
    if(declared>MAX_RESPONSE_BYTES)return{ok:false,http_status:response.status,error:"UPSTREAM_BODY_TOO_LARGE",body:null};
    const raw=await response.text();
    if(new TextEncoder().encode(raw).length>MAX_RESPONSE_BYTES)return{ok:false,http_status:response.status,error:"UPSTREAM_BODY_TOO_LARGE",body:null};
    let body=null;try{body=raw?JSON.parse(raw):null}catch{return{ok:false,http_status:response.status,error:"UPSTREAM_BAD_JSON",body:null}}
    return{ok:response.ok&&body?.ok!==false,http_status:response.status,error:response.ok?null:String(body?.error||`HTTP_${response.status}`),body};
  }catch(error){return{ok:false,http_status:0,error:error?.name==="AbortError"?"UPSTREAM_TIMEOUT":safe(error?.message||error),body:null}}
  finally{clearTimeout(timer)}
}

async function runBrainAdvisory(task,env){
  const result=await bindingJson(env.EXPERT_CENTER,new Request("https://expert.internal/v1/langgraph/run",{
    method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({mode:"brain-advisory",task})
  }),BRAIN_TIMEOUT_MS);
  const body=result.body||{};
  return{
    ok:result.ok&&body?.ok===true&&body?.mode==="brain-advisory"&&body?.tools_used===false&&body?.web_used===false&&body?.production_mutation===false,
    http_status:result.http_status,
    error:result.error||body?.error_code||body?.error||null,
    source:String(body?.source||"deterministic-governance-fallback"),
    provider:String(body?.provider||""),
    model:String(body?.model||""),
    brain_mode:String(body?.mode==="brain-advisory"?body?.source?body?.advisory?body?.runtime?body?.brain_mode||body?.advisory_mode||"":"":"":"":body?.brain_mode||""),
    inference_mode:String(body?.mode==="brain-advisory"?body?.advisory?body?.source?body?.fallback_used===true?"fallback":"primary":"":"":""),
    model_mode:String(body?.mode==="brain-advisory"?body?.advisory?body?.provider?body?.model?body?.source?body?.fallback_trigger?"":"":"":"":"":"":""),
    advisory:body?.advisory&&typeof body.advisory==="object"?body.advisory:null,
    fallback_used:body?.fallback_used===true,
    fallback_trigger:String(body?.fallback_trigger||""),
    candidate_models:Array.isArray(body?.candidate_models)?body.candidate_models.map(String).slice(0,6):[],
    model_invoked:body?.model_invoked===true,
    tools_used:body?.tools_used===true,
    web_used:body?.web_used===true,
    production_mutation:body?.production_mutation===true
  };
}

function boundedBrainAdvisory(task,brain){
  if(!brain?.ok||!brain.advisory)return task;
  const constraints=task?.constraints&&typeof task.constraints==="object"&&!Array.isArray(task.constraints)?task.constraints:{};
  const configured=Array.isArray(constraints.allowed_centers)?constraints.allowed_centers.map(String).filter(x=>ALLOWED_CENTERS.has(x)):Array.from(ALLOWED_CENTERS);
  const centers=new Set(configured),capabilities=new Set(Array.isArray(task.required_capabilities)?task.required_capabilities.map(String):[]),raw=brain.advisory;
  const preferred=uniq((Array.isArray(raw.preferred_centers)?raw.preferred_centers:[]).map(String).filter(x=>centers.has(x))).slice(0,4);
  const order=uniq((Array.isArray(raw.capability_order)?raw.capability_order:[]).map(String).filter(x=>capabilities.has(x))).slice(0,24);
  const advisory={preferred_centers:preferred,capability_order:order,force_deep:raw.force_deep===true,source:brain.source,provider:brain.provider,model:brain.model};
  return{...task,constraints:{...constraints,brain_advisory:advisory}};
}

async function compileGovernancePlan(task,env){
  return bindingJson(env.GOVERNANCE_CENTER,new Request("https://governance.internal/v1/evolution/internal-plan",{
    method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(task)
  }),20000);
}

async function validateWithLangGraph(plan,env){
  return bindingJson(env.EXPERT_CENTER,new Request("https://expert.internal/v1/langgraph/run",{
    method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({mode:"supervisor-validate",plan})
  }),20000);
}

async function dispatchPlanProbes(plan,env){
  const nodes=Array.isArray(plan?.graph?.nodes)?plan.graph.nodes:[];
  const receipts=[];
  for(const node of nodes){
    const center=String(node?.center||""),probe=CENTER_PROBES[center];
    if(!probe){receipts.push({step_id:String(node?.step_id||""),center,capability_id:String(node?.capability_id||""),ok:false,http_status:0,error:"CENTER_NOT_ALLOWED"});continue}
    const result=await bindingJson(env[probe.binding],new Request(probe.url,{method:"GET",headers:{accept:"application/json"}}),12000);
    receipts.push({step_id:String(node?.step_id||""),center,capability_id:String(node?.capability_id||""),ok:result.ok,http_status:result.http_status,error:result.error});
    if(!result.ok)break;
  }
  return receipts;
}

async function runExpertRouteSelftest(env){
  const result=await bindingJson(env.EXPERT_CENTER,new Request("https://expert.internal/v1/selftest",{
    method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:"{}"
  }),180000);
  const body=result.body||{};
  return{
    ok:result.ok&&body?.ok===true&&body?.business_e2e===true&&body?.model_policy_pass===true&&body?.company_diverse===true&&body?.expert_nonempty===true&&body?.judge_nonempty===true,
    http_status:result.http_status,
    error:result.error||body?.error||null,
    models:Array.isArray(body?.models)?body.models.map(String):[],
    company_diverse:body?.company_diverse===true,
    model_policy_pass:body?.model_policy_pass===true,
    expert_nonempty:body?.expert_nonempty===true,
    judge_nonempty:body?.judge_nonempty===true,
    output_digest:String(body?.output_digest||""),
    content_scrubbed:body?.content_scrubbed===true
  };
}

function systemCanaryTask(){
  return{
    task_id:`langgraph-system-canary-${crypto.randomUUID()}`,
    goal:"Verify that the shared LangGraph brain can validate and command the governance, intelligence, compute and expert centers through Cloudflare Service Bindings.",
    constraints:{allowed_centers:["governance","intelligence","compute","expert"],write_scope:"none"},
    risk:{max_trust_level:"T2",uncertainty:"low"},
    budget:{cost_mode:"free-first",max_paid_usd:0},
    required_capabilities:["governance.task-planner","intelligence.provider-query","compute.cpu","expert.deliberation"],
    deadline:new Date(Date.now()+5*60*1000).toISOString(),
    success_criteria:["all four centers are reachable","LangGraph validates the cross-center graph","Expert AI Gateway executes a real two-participant selftest"]
  };
}

async function orchestrate(task,env,{expertRouteSelftest=false}={}){
  const brain=await runBrainAdvisory(task,env),effectiveTask=boundedBrainAdvisory(task,brain);
  const planning=await compileGovernancePlan(effectiveTask,env);
  const plan=planning.body;
  if(!planning.ok||plan?.ok!==true)return{ok:false,status:"planning-failed",error:planning.error||plan?.error||"GOVERNANCE_PLAN_FAILED",brain,planning_http_status:planning.http_status,plan:null,langgraph:null,dispatch_receipts:[],expert_route_selftest:null};

  const validation=await validateWithLangGraph(plan,env),langgraph=validation.body;
  const validated=validation.ok&&langgraph?.ok===true&&langgraph?.mode==="supervisor-validate"&&langgraph?.validation?.ok===true&&langgraph?.model_invoked===false&&langgraph?.tools_used===false&&langgraph?.web_used===false;
  if(!validated)return{ok:false,status:"langgraph-rejected",error:validation.error||langgraph?.error||"LANGGRAPH_VALIDATION_FAILED",brain,planning_http_status:planning.http_status,plan,langgraph,dispatch_receipts:[],expert_route_selftest:null};

  const dispatchReceipts=await dispatchPlanProbes(plan,env),dispatchOk=dispatchReceipts.length===plan.graph.nodes.length&&dispatchReceipts.every(x=>x.ok);
  if(!dispatchOk)return{ok:false,status:"dispatch-failed",error:dispatchReceipts.find(x=>!x.ok)?.error||"CENTER_DISPATCH_FAILED",brain,planning_http_status:planning.http_status,plan,langgraph,dispatch_receipts:dispatchReceipts,expert_route_selftest:null};

  const routeTest=expertRouteSelftest?await runExpertRouteSelftest(env):null;
  const ok=dispatchOk&&(!expertRouteSelftest||routeTest?.ok===true);
  return{ok,status:ok?"completed":"expert-route-failed",error:ok?null:(routeTest?.error||"EXPERT_ROUTE_SELFTEST_FAILED"),brain,planning_http_status:planning.http_status,plan,langgraph,dispatch_receipts:dispatchReceipts,expert_route_selftest:routeTest};
}

export async function handleLangGraphControl(request,env){
  const url=new URL(request.url),isCanary=request.method==="POST"&&url.pathname==="/v1/admin/langgraph/canary",isRun=request.method==="POST"&&url.pathname==="/v1/admin/langgraph/run";
  if(!isCanary&&!isRun)return null;
  const probeAuthorized=isCanary&&constantTimeEqual(request.headers.get("x-langgraph-e2e-probe"),env.LANGGRAPH_SYSTEM_E2E_PROBE);
  if(!internalOnly(url)&&!probeAuthorized)return json({ok:false,error:"POLICY_DENIED",message:"LangGraph system control is service-binding internal only"},403);
  try{
    const task=isCanary?systemCanaryTask():await strictJson(request),result=await orchestrate(task,env,{expertRouteSelftest:isCanary});
    const plan=result.plan||{},brain=result.brain||{};
    const payload={
      ok:result.ok,
      selftest:isCanary?"langgraph-system-command-v1":null,
      status:result.status,
      error:result.error,
      runtime:"@langchain/langgraph@1.4.10",
      runtime_host:"expert-worker",
      control_plane:"admin-worker",
      planner:"governance-worker",
      brain_source:String(brain.source||"deterministic-governance-fallback"),
      brain_model_invoked:brain.model_invoked===true,
      brain_provider:String(brain.provider||""),
      brain_model:String(brain.model||""),
      brain_fallback_used:brain.fallback_used===true,
      brain_fallback_trigger:String(brain.fallback_trigger||""),
      brain_degraded:brain.ok!==true,
      brain_tools_used:brain.tools_used===true,
      brain_web_used:brain.web_used===true,
      brain_production_mutation:brain.production_mutation===true,
      task_id:String(task?.task_id||""),
      plan_digest:String(plan?.plan_digest||""),
      plan_path:String(plan?.path||""),
      brain_advisory_applied:plan?.brain_advisory?.applied===true,
      planned_centers:Array.isArray(plan?.graph?.nodes)?plan.graph.nodes.map(x=>String(x?.center||"")):[],
      langgraph_validated:result.langgraph?.validation?.ok===true,
      langgraph_model_invoked:result.langgraph?.model_invoked===true,
      langgraph_tools_used:result.langgraph?.tools_used===true,
      langgraph_web_used:result.langgraph?.web_used===true,
      dispatch_receipts:result.dispatch_receipts,
      expert_route_selftest:result.expert_route_selftest,
      brain_can_command:result.ok===true,
      execution_mode:"model-advisory-governance-validated-bounded-service-binding-dispatch",
      production_mutation:false,
      secrets_redacted:true
    };
    return json(payload,result.ok?200:502);
  }catch(error){return json({ok:false,selftest:isCanary?"langgraph-system-command-v1":null,status:"failed",error:safe(error?.message||error),brain_can_command:false,production_mutation:false,secrets_redacted:true},error?.status||500)}
}
