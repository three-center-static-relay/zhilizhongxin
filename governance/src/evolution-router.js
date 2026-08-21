import {collectCapabilityManifests,compileTaskPlan,buildSelfModel,entropyReport,kernelSnapshot,validateEvolutionContract} from "./evolution-kernel.js";
import {emitEvolutionMetric} from "./evolution-telemetry.js";

const MAX_BODY_BYTES=65536;
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const TASK_ENVELOPE_SCHEMA={type:"object",additionalProperties:false,required:["task_id","goal","constraints","risk","budget","required_capabilities","deadline","success_criteria"],properties:{task_id:{type:"string",pattern:"^[A-Za-z0-9._:-]{1,160}$"},goal:{type:"string",minLength:1,maxLength:4000},constraints:{type:"object",additionalProperties:true},risk:{type:"object",additionalProperties:true},budget:{type:"object",additionalProperties:true},required_capabilities:{type:"array",minItems:1,maxItems:24,items:{type:"string"}},deadline:{type:"string",format:"date-time"},success_criteria:{type:"array",minItems:1,maxItems:24,items:{type:"string"}}}};

async function equalSecret(provided,expected){
  const encoder=new TextEncoder();
  const [left,right]=await Promise.all([
    crypto.subtle.digest("SHA-256",encoder.encode(String(provided||""))),
    crypto.subtle.digest("SHA-256",encoder.encode(String(expected||"")))
  ]);
  if(typeof crypto.subtle.timingSafeEqual==="function")return crypto.subtle.timingSafeEqual(left,right);
  const a=new Uint8Array(left),b=new Uint8Array(right);let diff=0;
  for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}

async function authenticate(request,env){
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return{ok:false,status:401,error:"UNAUTHORIZED"};
  if(!env.ADMIN_GPT_TOKEN)return{ok:false,status:503,error:"ADMIN_TOKEN_NOT_CONFIGURED"};
  return await equalSecret(header.slice(7).trim(),env.ADMIN_GPT_TOKEN)?{ok:true}:{ok:false,status:401,error:"UNAUTHORIZED"};
}

async function strictJson(request){
  const declared=Number(request.headers.get("content-length")||0);
  if(declared>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  if(!raw)return{};
  try{const body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();return body}catch{throw Object.assign(new Error("INVALID_REQUEST"),{status:400})}
}

function audit(event,details={}){
  console.log(JSON.stringify({event,kernel:"open-adaptive-kernel-v1",observed_at:new Date().toISOString(),...details,secrets_redacted:true}));
}

async function authorized(request,env,operation){
  const auth=await authenticate(request,env);
  if(!auth.ok)return json({ok:false,error:auth.error,http_status:auth.status},auth.status);
  return operation();
}

async function compilePlanResponse(request,env){
  try{
    const task=await strictJson(request),collected=await collectCapabilityManifests(env),plan=await compileTaskPlan(task,collected.manifests);
    audit("evolution.plan",{task_id:task.task_id||null,status:plan.status,path:plan.path||null,manifest_status:collected.status});
    emitEvolutionMetric(env,"evolution.plan",{ok:plan.ok,status:plan.status,task_id:task.task_id||null,path:plan.path||null,capability_count:plan.context_compiler?.input_capabilities||0,gap_count:plan.gap_model?.gap_count||0,evolution_pressure:plan.gap_model?.evolution_pressure||0});
    if(plan.status==="INVALID")return json({...plan,manifest_status:collected.status,manifest_errors:collected.errors},400);
    return json({...plan,manifest_status:collected.status,manifest_errors:collected.errors},plan.ok?200:422);
  }catch(error){return json({ok:false,error:String(error?.message||"PLAN_FAILED"),execution_started:false,production_mutation:false},error?.status||500)}
}

export function evolutionOpenApiPaths(){
  return{
    "/v1/evolution/kernel":{get:{operationId:"getEvolutionKernel",summary:"Read the immutable adaptive-system kernel and phase gates",responses:{"200":{description:"Read-only kernel snapshot; no production mutation."}}}},
    "/v1/evolution/self-model":{get:{operationId:"getEvolutionSelfModel",summary:"Compile a live four-center capability self-model",security:[{BearerAuth:[]}],responses:{"200":{description:"All four capability manifests compiled."},"207":{description:"Partial model with explicit missing-center errors."},"401":{description:"Unauthorized."}}}},
    "/v1/evolution/entropy":{get:{operationId:"getEvolutionEntropy",summary:"Run observe-only redundancy, staleness and fragility analysis",security:[{BearerAuth:[]}],responses:{"200":{description:"Observe-only anti-entropy report; automatic deletion is disabled."},"401":{description:"Unauthorized."}}}},
    "/v1/evolution/plan":{post:{operationId:"compileEvolutionTaskPlan",summary:"Compile a side-effect-free Fast/Deep capability graph",security:[{BearerAuth:[]}],requestBody:{required:true,content:{"application/json":{schema:TASK_ENVELOPE_SCHEMA}}},responses:{"200":{description:"Task plan compiled without execution."},"400":{description:"Invalid Task Envelope."},"422":{description:"Required capabilities unresolved; fail-closed gap report returned."}}}},
    "/v1/evolution/candidates/validate":{post:{operationId:"validateEvolutionCandidateContract",summary:"Validate an evolution contract before quarantine",security:[{BearerAuth:[]}],requestBody:{required:true,content:{"application/json":{schema:{type:"object",additionalProperties:true}}}},responses:{"200":{description:"Contract valid; candidate may enter quarantine only."},"422":{description:"Contract invalid or direct production mutation requested."}}}}
  };
}

export async function handleEvolutionRoute(request,env){
  const url=new URL(request.url);
  if(request.method==="GET"&&url.pathname==="/v1/evolution/kernel")return json(kernelSnapshot());
  if(request.method==="POST"&&url.pathname==="/v1/evolution/internal-plan"){
    if(url.hostname!=="governance.internal")return json({ok:false,error:"POLICY_DENIED",message:"internal planner is service-binding only"},403);
    return compilePlanResponse(request,env);
  }
  if(request.method==="GET"&&url.pathname==="/v1/evolution/self-model")return authorized(request,env,async()=>{
    const collected=await collectCapabilityManifests(env),model=buildSelfModel(collected.manifests);
    audit("evolution.self-model",{status:collected.status,capability_count:model.capability_count});
    emitEvolutionMetric(env,"evolution.self-model",{ok:collected.ok,status:collected.status,capability_count:model.capability_count,healthy_count:model.healthy_count,unhealthy_count:model.unhealthy.length});
    return json({ok:collected.ok,status:collected.status,self_model:model,manifest_errors:collected.errors,production_mutation:false},collected.ok?200:207);
  });
  if(request.method==="GET"&&url.pathname==="/v1/evolution/entropy")return authorized(request,env,async()=>{
    const collected=await collectCapabilityManifests(env),report=entropyReport(collected.manifests);
    audit("evolution.entropy",{status:collected.status,signals:report.signals});
    emitEvolutionMetric(env,"evolution.entropy",{ok:collected.ok,status:collected.status,staleness:report.signals.staleness,fragility:report.signals.fragility});
    return json({ok:collected.ok,status:collected.status,entropy:report,manifest_errors:collected.errors},collected.ok?200:207);
  });
  if(request.method==="POST"&&url.pathname==="/v1/evolution/plan")return authorized(request,env,()=>compilePlanResponse(request,env));
  if(request.method==="POST"&&url.pathname==="/v1/evolution/candidates/validate")return authorized(request,env,async()=>{
    try{
      const candidate=await strictJson(request),validation=validateEvolutionContract(candidate);
      audit("evolution.candidate.validate",{candidate_id:candidate.candidate_id||null,valid:validation.ok});
      emitEvolutionMetric(env,"evolution.candidate.validate",{ok:validation.ok,status:validation.next_stage||"repair",candidate_id:candidate.candidate_id||null,complexity_delta:candidate.complexity_delta,risk_delta:candidate.risk_delta});
      return json({...validation,candidate_id:candidate.candidate_id||null,autonomous_promotion:false},validation.ok?200:422);
    }catch(error){return json({ok:false,error:String(error?.message||"CANDIDATE_VALIDATION_FAILED"),promotion_eligible:false},error?.status||500)}
  });
  return null;
}
