import base,{MaintenanceState,AIGatewayCredentialRead} from "./index.js";
export {MaintenanceState,AIGatewayCredentialRead};

// Post-PR exact-head trigger only; Phase2 behavior is unchanged.
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const expectedShards=["lanes-1-2","lanes-3-4","lanes-5-6","lanes-7-8"];
function constantTimeEqual(a,b){a=String(a||"");b=String(b||"");if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
function safe(v){return String(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:/-]/g,"_").slice(0,180)}
function routeShard(lane){const n=Math.trunc(Number(lane));if(!Number.isFinite(n)||n<1||n>8)return null;return n<=2?"lanes-1-2":n<=4?"lanes-3-4":n<=6?"lanes-5-6":"lanes-7-8"}
function denied(model,provider){const x=`${provider||""}/${model||""}`.toLowerCase();return x.includes("openai")||x.includes("anthropic")||x.includes("claude")}
function authorize(req,env){const expected=String(env.MAINTENANCE_RUNTIME_E2E_PROBE||"");const supplied=req.headers.get("x-maintenance-e2e-probe")||"";return Boolean(expected)&&constantTimeEqual(expected,supplied)&&String(env.MAINTENANCE_EXPERT_PHASE2_PROBE||"")==="1"}
async function phase2(req,env){
  if(!authorize(req,env))return json({ok:false,error:"NOT_FOUND"},404);
  if(!env.EXPERT_CENTER?.fetch)return json({ok:false,selftest:"maintenance-expert-v4.2-phase2-v1",error_code:"EXPERT_CENTER_UNBOUND",secrets_redacted:true},503);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),240000);
  try{
    const healthResponse=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/health",{method:"GET",headers:{accept:"application/json"},signal:controller.signal}));
    const health=await healthResponse.json().catch(()=>null);
    const gateway=health?.ai_gateway||{};
    const routeContract=healthResponse.status===200&&health?.ok===true&&health?.legacy_panel_removed===true&&gateway?.legacy_base_route_removed===true&&gateway?.route_registry_schema==="expert-route-registry-v4.2-lane-pair"&&gateway?.route_selection==="global-lane-pair"&&Number(gateway?.max_lanes_per_route)===2&&expectedShards.every(x=>Array.isArray(gateway?.route_shards)&&gateway.route_shards.includes(x));
    if(!routeContract)return json({ok:false,selftest:"maintenance-expert-v4.2-phase2-v1",error_code:"EXPERT_ROUTE_CONTRACT_NOT_LIVE",health_status:healthResponse.status,secrets_redacted:true},502);
    const taskId=`phase2-${crypto.randomUUID()}`;
    const runResponse=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/run",{method:"POST",headers:{accept:"application/json","content-type":"application/json","x-three-center-selftest":"1"},body:JSON.stringify({task_id:taskId,prompt:"Phase-2 production acceptance only. Return exactly: 2 — 1+1=2. Do not add external facts.",model_count:2,max_tokens:256,timeout_seconds:180,cost_mode:"balanced"}),signal:controller.signal}));
    const body=await runResponse.json().catch(()=>null);
    const experts=Array.isArray(body?.experts)?body.experts:[],judges=Array.isArray(body?.judges)?body.judges:[],participants=[...experts,...judges];
    const receipts=participants.map(p=>({model:String(p?.model||""),provider:String(p?.provider||""),company:String(p?.company||""),lane:Number(p?.meta?.lane||p?.lane||0),route_shard:routeShard(p?.meta?.lane||p?.lane)}));
    const models=Array.isArray(body?.models)?body.models.map(String):[],companies=Array.isArray(body?.companies)?body.companies.map(String):[];
    const uniqueCompanies=companies.length===models.length&&companies.length>=2&&new Set(companies.map(x=>x.toLowerCase())).size===companies.length;
    const receiptsComplete=receipts.length===models.length&&receipts.length>=2&&receipts.every(r=>r.model&&r.provider&&r.company&&r.route_shard&&!denied(r.model,r.provider));
    const receiptModelsMatch=receiptsComplete&&receipts.every(r=>models.includes(r.model)&&companies.includes(r.company));
    const routeMetadataOk=receiptsComplete&&receipts.every(r=>Number.isInteger(r.lane)&&r.lane>=1&&r.lane<=8);
    const ok=runResponse.status===200&&body?.ok===true&&body?.status==="completed"&&body?.company_diverse===true&&uniqueCompanies&&receiptsComplete&&receiptModelsMatch&&routeMetadataOk&&body?.route_family==="expert-panel"&&body?.route_registry_schema==="expert-route-registry-v4.2-lane-pair";
    return json({ok,selftest:"maintenance-expert-v4.2-phase2-v1",expert_http_status:runResponse.status,task_id:taskId,route_family:String(body?.route_family||""),route_registry_schema:String(body?.route_registry_schema||""),route_selection:"global-lane-pair",provider_model_receipts:receipts,models,companies,company_diverse:uniqueCompanies&&body?.company_diverse===true,expert_count:Number(body?.expert_count||0),judge_count:Number(body?.judge_count||0),output_digest:String(body?.output_digest||""),content_scrubbed:true,legacy_route_used:false,tools_used:false,web_used:false,expert_worker_mutated:false,expert_business_traffic_changed:false,secrets_redacted:true,error_code:ok?null:"EXPERT_PHASE2_ACCEPTANCE_FAILED"},ok?200:502);
  }catch(error){return json({ok:false,selftest:"maintenance-expert-v4.2-phase2-v1",error_code:error?.name==="AbortError"?"EXPERT_PHASE2_TIMEOUT":safe(error?.message||error),content_scrubbed:true,secrets_redacted:true},502)}finally{clearTimeout(timer)}
}

export default{
  async fetch(req,env,ctx){const u=new URL(req.url);if(req.method==="POST"&&u.pathname==="/v1/maintenance/runtime-expert-phase2")return phase2(req,env);return base.fetch(req,env,ctx)},
  async scheduled(controller,env,ctx){return base.scheduled(controller,env,ctx)}
};
