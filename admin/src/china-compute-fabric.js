import {tencentExecutorStatus,tencentAgentInvoke} from "./tencent-executor.js";

const COMPUTE_ORIGIN="https://compute.internal";
const STATUS_TTL_MS=60000;
const JSON_HEADERS={"content-type":"application/json;charset=utf-8","cache-control":"no-store"};
const PROVIDERS=["tencent","modelscope","baidu","huawei","aliyun"];
const CAPABILITIES=["agent","browser","tool-agent","free-cpu","llm","functiongraph","paid-sandbox"];
let statusCache={at:0,value:null};

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});
const cleanText=(value,max=120)=>String(value||"").replace(/[A-Za-z0-9._~-]{24,}/g,"[REDACTED]").replace(/\s+/g," ").slice(0,max);
const bool=value=>value===true;
const sha=value=>/^[a-f0-9]{40,64}$/i.test(String(value||""));

async function readJson(response){return await response.json().catch(()=>null)}
async function computeRequest(env,path,{method="GET",body}={}){
  if(!env.COMPUTE_CENTER?.fetch)return {response:null,body:null,error:"COMPUTE_CENTER_UNAVAILABLE"};
  const init={method,headers:{accept:"application/json","content-type":"application/json"}};
  if(body!==undefined)init.body=JSON.stringify(body);
  try{
    const response=await env.COMPUTE_CENTER.fetch(new Request(`${COMPUTE_ORIGIN}${path}`,init));
    return {response,body:await readJson(response),error:null};
  }catch(error){return {response:null,body:null,error:cleanText(error?.message||error)}}
}

function tencentAttested(env){
  const commit=String(env.TENCENT_PRODUCTION_E2E_ATTESTED||"").trim();
  const failure=String(env.TENCENT_PRODUCTION_E2E_FAILURE||"").trim();
  return sha(commit)&&!failure;
}

function normalizedProvider(id,{ok=false,routeEligible=false,lifecycle=null,role=null,costClass="unknown",explicitOnly=true,automatic=false,detail=null}={}){
  return {provider:id,ok:bool(ok),route_eligible:bool(routeEligible),lifecycle,role,cost_class:costClass,explicit_selection_only:bool(explicitOnly),automatic_routing_allowed:bool(automatic),paid_fallback:false,detail};
}

export async function chinaFabricStatus(env,{fresh=false}={}){
  const now=Date.now();
  if(!fresh&&statusCache.value&&now-statusCache.at<STATUS_TTL_MS)return {...statusCache.value,cached:true,cache_age_ms:now-statusCache.at};

  const [tencentResponse,modelscope,baidu,huawei,aliyun]=await Promise.all([
    tencentExecutorStatus(env),
    computeRequest(env,"/v1/selftest/modelscope-studio-lite"),
    computeRequest(env,"/v1/providers/baidu-llm/health"),
    computeRequest(env,"/v1/providers/huawei-functiongraph/meta"),
    computeRequest(env,"/v1/providers/aliyun-fc-sandbox/health")
  ]);
  const tencent=await readJson(tencentResponse),tencentProduction=tencentAttested(env);
  const providers={
    tencent:normalizedProvider("tencent",{ok:tencentResponse.ok&&tencent?.ok===true&&tencentProduction,routeEligible:tencentResponse.ok&&tencent?.ok===true&&tencentProduction,lifecycle:tencentProduction?"production-attested":"fail-closed",role:"agent-browser-tools",costClass:"platform-contained",explicitOnly:false,automatic:true,detail:{stable_domain:tencent?.stable_domain_configured===true,production_attested:tencentProduction}}),
    modelscope:normalizedProvider("modelscope",{ok:modelscope.response?.ok&&modelscope.body?.production_accepted===true,routeEligible:modelscope.body?.route_eligible===true,lifecycle:modelscope.body?.lifecycle||null,role:"free-light-cpu-demand-workflow",costClass:"free-only",explicitOnly:false,automatic:true,detail:{free_only:modelscope.body?.free_only===true,stock_available:modelscope.body?.stock_available===true,runtime_e2e_attested:modelscope.body?.runtime_e2e_attested===true}}),
    baidu:normalizedProvider("baidu",{ok:baidu.response?.ok&&baidu.body?.authenticated===true,routeEligible:baidu.body?.route_eligible===true,lifecycle:"production-bounded-inference",role:"china-llm-inference",costClass:"free-quota-then-metered-unknown",explicitOnly:true,automatic:false,detail:{selected_model:baidu.body?.selected_model||null,models_visible:Number(baidu.body?.models_visible||0)}}),
    huawei:normalizedProvider("huawei",{ok:huawei.response?.ok&&huawei.body?.runtime_e2e_attested===true,routeEligible:huawei.body?.route_eligible===true,lifecycle:huawei.body?.lifecycle||null,role:"configured-functiongraph-specialist",costClass:"free-tier-then-metered",explicitOnly:true,automatic:false,detail:{runtime_e2e_attested:huawei.body?.runtime_e2e_attested===true,route_scope:huawei.body?.route_scope||null}}),
    aliyun:normalizedProvider("aliyun",{ok:aliyun.response?.ok&&aliyun.body?.authenticated===true&&aliyun.body?.runtime_e2e_verified===true,routeEligible:aliyun.body?.route_eligible===true,lifecycle:aliyun.body?.lifecycle||null,role:"explicit-paid-sandbox",costClass:"paid",explicitOnly:true,automatic:false,detail:{runtime_e2e_verified:aliyun.body?.runtime_e2e_verified===true,explicit_paid_ack_required:true}})
  };
  const value={ok:true,fabric:"china-compute-fabric-v1",checked_at:new Date().toISOString(),providers,policy:{free_first:true,paid_fallback:false,no_implicit_metered_execution:true,fail_closed:true,automatic_provider_set:["tencent","modelscope"],explicit_metered_provider_set:["baidu","huawei"],explicit_paid_provider_set:["aliyun"]},secrets_redacted:true};
  statusCache={at:now,value};
  return {...value,cached:false,cache_age_ms:0};
}

function normalizeProvider(value){
  const v=String(value||"").trim().toLowerCase();
  if(["tencent","edgeone","tencent-edgeone"].includes(v))return "tencent";
  if(["modelscope","moda","魔塔"].includes(v))return "modelscope";
  if(["baidu","baidu-aistudio","ernie"].includes(v))return "baidu";
  if(["huawei","functiongraph","huawei-functiongraph"].includes(v))return "huawei";
  if(["aliyun","ali","alibaba","aliyun-fc","aliyun-fc-sandbox"].includes(v))return "aliyun";
  return v;
}
function inferCapability(body={}){
  const explicit=String(body.capability||body.task_type||"").trim().toLowerCase();
  if(explicit)return explicit;
  const provider=normalizeProvider(body.provider);
  if(provider==="huawei")return "functiongraph";
  if(provider==="baidu")return "llm";
  if(provider==="aliyun")return "paid-sandbox";
  if(provider==="modelscope")return "free-cpu";
  if(body.browser===true||body.url)return "browser";
  if(body.messages||body.prompt)return "llm";
  if(body.function_payload||body.payload&&body.functiongraph===true)return "functiongraph";
  if(body.code||body.command)return "tool-agent";
  if(body.message)return "agent";
  return "agent";
}
function defaultProvider(capability){
  if(["agent","browser","tool-agent"].includes(capability))return "tencent";
  if(capability==="free-cpu")return "modelscope";
  if(capability==="llm")return "baidu";
  if(capability==="functiongraph")return "huawei";
  if(capability==="paid-sandbox")return "aliyun";
  return null;
}
function compatible(provider,capability){
  if(provider==="tencent")return ["agent","browser","tool-agent"].includes(capability);
  if(provider==="modelscope")return capability==="free-cpu";
  if(provider==="baidu")return capability==="llm";
  if(provider==="huawei")return capability==="functiongraph";
  if(provider==="aliyun")return capability==="paid-sandbox";
  return false;
}

export function planChinaFabric(body={},status){
  const capability=inferCapability(body);
  if(!CAPABILITIES.includes(capability))return {ok:false,error:"UNSUPPORTED_CAPABILITY",capability,allowed_capabilities:CAPABILITIES};
  const requested=normalizeProvider(body.provider),provider=requested||defaultProvider(capability);
  if(!PROVIDERS.includes(provider))return {ok:false,error:"UNKNOWN_PROVIDER",provider,allowed_providers:PROVIDERS};
  if(!compatible(provider,capability))return {ok:false,error:"PROVIDER_CAPABILITY_MISMATCH",provider,capability};
  const state=status?.providers?.[provider];
  if(!state?.route_eligible)return {ok:false,error:"PROVIDER_NOT_READY",provider,capability,route_eligible:false,provider_state:state||null};
  const requiresPaid=provider==="aliyun",requiresMetered=["baidu","huawei"].includes(provider);
  const paidAck=body.allow_paid===true,meteredAck=body.allow_metered===true;
  const acknowledgement_required=requiresPaid&&!paidAck?"allow_paid":requiresMetered&&!meteredAck?"allow_metered":null;
  return {ok:true,fabric:"china-compute-fabric-v1",capability,provider,route_eligible:true,automatic_selection:!requested,acknowledgement_required,execution_allowed:acknowledgement_required===null,cost_class:state.cost_class,paid_fallback:false,fail_closed:true,reason:requested?"explicit-compatible-provider":"capability-default-provider"};
}

function withFabricHeaders(response,provider){
  const headers=new Headers(response.headers);headers.set("cache-control","no-store");headers.set("x-three-center-fabric","china-compute-fabric-v1");headers.set("x-three-center-provider",provider);headers.delete("set-cookie");return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
function compactInput(body={}){return body.input&&typeof body.input==="object"&&!Array.isArray(body.input)?body.input:body}

export async function runChinaFabric(body,env){
  const status=await chinaFabricStatus(env),plan=planChinaFabric(body,status);
  if(!plan.ok)return json(plan,plan.error==="PROVIDER_NOT_READY"?503:400);
  if(plan.acknowledgement_required)return json({...plan,error:plan.acknowledgement_required==="allow_paid"?"PAID_EXECUTION_ACK_REQUIRED":"METERED_EXECUTION_ACK_REQUIRED"},plan.acknowledgement_required==="allow_paid"?402:409);
  const input=compactInput(body);
  if(plan.provider==="tencent"){
    const message=String(input.message||body.message||"").trim();
    if(!message)return json({ok:false,error:"MESSAGE_REQUIRED",provider:"tencent"},400);
    const request=new Request("https://admin.internal/v1/admin/tencent/agent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message,conversation_id:body.conversation_id||input.conversation_id})});
    return withFabricHeaders(await tencentAgentInvoke(request,env),"tencent");
  }
  if(plan.provider==="modelscope"){
    const call=await computeRequest(env,"/v1/admin/modelscope/studio-lite/run",{method:"POST",body:{}});
    if(!call.response)return json({ok:false,error:call.error||"MODELSCOPE_WORKFLOW_START_FAILED",provider:"modelscope"},502);
    return withFabricHeaders(call.response,"modelscope");
  }
  if(plan.provider==="baidu"){
    const payload={};for(const key of ["prompt","messages","model","max_completion_tokens","max_tokens","temperature"])if(input[key]!==undefined)payload[key]=input[key];
    const call=await computeRequest(env,"/v1/providers/baidu-llm/inference",{method:"POST",body:payload});
    if(!call.response)return json({ok:false,error:call.error||"BAIDU_INFERENCE_FAILED",provider:"baidu"},502);
    return withFabricHeaders(call.response,"baidu");
  }
  if(plan.provider==="huawei"){
    const payload=input.function_payload??input.payload??body.function_payload??body.payload??input;
    const call=await computeRequest(env,"/v1/providers/huawei-functiongraph/compute",{method:"POST",body:payload});
    if(!call.response)return json({ok:false,error:call.error||"HUAWEI_FUNCTIONGRAPH_FAILED",provider:"huawei"},502);
    return withFabricHeaders(call.response,"huawei");
  }
  if(plan.provider==="aliyun"){
    const call=await computeRequest(env,"/v1/providers/aliyun-fc-sandbox/run",{method:"POST",body:{allow_paid:true,op:input.op||body.op||"python",code:input.code??body.code,command:input.command??body.command,timeout_seconds:input.timeout_seconds??body.timeout_seconds}});
    if(!call.response)return json({ok:false,error:call.error||"ALIYUN_SANDBOX_FAILED",provider:"aliyun"},502);
    return withFabricHeaders(call.response,"aliyun");
  }
  return json({ok:false,error:"FABRIC_DISPATCH_UNREACHABLE"},500);
}

export async function chinaFabricTaskStatus(url,env){
  const provider=normalizeProvider(url.searchParams.get("provider"));
  const id=String(url.searchParams.get("id")||"").trim();
  if(provider!=="modelscope")return json({ok:false,error:"TASK_STATUS_PROVIDER_UNSUPPORTED",supported:["modelscope"]},400);
  if(!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/.test(id))return json({ok:false,error:"INVALID_TASK_ID"},400);
  const call=await computeRequest(env,`/v1/admin/modelscope/studio-lite/workflow?id=${encodeURIComponent(id)}`);
  if(!call.response)return json({ok:false,error:call.error||"TASK_STATUS_FAILED",provider},502);
  return withFabricHeaders(call.response,provider);
}
