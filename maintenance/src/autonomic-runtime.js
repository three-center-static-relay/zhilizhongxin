const PRIMARY_MODEL="@cf/nvidia/nemotron-3-120b-a12b";
const REVIEW_MODEL="@cf/google/gemma-4-26b-a4b-it";
const clean=v=>String(v??"").trim();
const safe=v=>clean(v||"UNKNOWN").replace(/[^0-9A-Za-z_.:,=@/-]/g,"_").slice(0,180);
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

function stateStub(env){return env.MAINTENANCE_STATE.get(env.MAINTENANCE_STATE.idFromName("global"))}
async function stateGet(env){const r=await stateStub(env).fetch(new Request("https://state.internal/latest"));const b=await r.json().catch(()=>({}));return b?.latest&&typeof b.latest==="object"?b.latest:{}}
async function statePut(env,value){await stateStub(env).fetch(new Request("https://state.internal/latest",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)}))}
function modelText(result){const direct=clean(result?.response);if(direct)return direct;const content=result?.choices?.[0]?.message?.content;return typeof content==="string"?clean(content):""}
function boundedReceipt(value){const x=value&&typeof value==="object"?value:{};return{center:clean(x.center).slice(0,80)||"unknown",stage:clean(x.stage).slice(0,100)||"unknown",status:clean(x.status).slice(0,60),error_code:clean(x.error_code||x.error).slice(0,180),http_status:Number(x.http_status||x.status_code||0),provider:clean(x.provider).slice(0,100),model:clean(x.model).slice(0,180),failure_streak:Math.max(0,Math.min(20,Number(x.failure_streak||x.failure_count||0))),failed_checks:Array.isArray(x.failed_checks)?x.failed_checks.slice(0,12).map(v=>({center:clean(v?.center).slice(0,50),path:clean(v?.path).slice(0,100),http_status:Number(v?.http_status||0),error:clean(v?.error).slice(0,100)})):[]}}

export async function runNemotronAdvisory(env,receipt={},trigger="manual"){
  if(!env.AI?.run)return{ok:false,error:"WORKERS_AI_UNBOUND",model:PRIMARY_MODEL};
  const incident=boundedReceipt(receipt);
  const prompt={trigger,incident,constraints:{free_first:true,max_paid_usd:0,tools:false,web:false,production_mutation:false,approved_model_sources:["workers-ai","openrouter","huggingface"]},required_output:{diagnosis:"string",root_cause_class:"string",recommended_next_action:"string",safe_auto_action:"string|null",confidence:"0..1"}};
  const result=await env.AI.run(PRIMARY_MODEL,{messages:[{role:"system",content:"You are the bounded maintenance brain for a Cloudflare multi-center system. Diagnose only from supplied structured facts. Do not browse, call tools, expose secrets, spend paid budget, mutate production, or self-approve releases. Prefer retry, fallback, quarantine, rollback, route/config repair, and deterministic verification. Return compact JSON only."},{role:"user",content:JSON.stringify(prompt)}],temperature:0,max_completion_tokens:600,stream:false});
  const advisory={ok:true,at:new Date().toISOString(),trigger,provider:"workers-ai",model:PRIMARY_MODEL,review_model:REVIEW_MODEL,text:modelText(result).slice(0,3000),tools_used:false,web_used:false,paid_spend_usd:0,production_mutation:false,requires_deterministic_validation:true};
  const latest=await stateGet(env);await statePut(env,{...latest,autonomic:advisory});
  console.log(JSON.stringify({event:"nemotron-autonomic-advisory",trigger,model:PRIMARY_MODEL,secrets_redacted:true}));
  return advisory;
}

export async function handleAutonomicRequest(req,env){
  const u=new URL(req.url);if(u.hostname!=="maintenance.internal")return json({ok:false,error:"POLICY_DENIED"},403);
  const raw=await req.text();if(new TextEncoder().encode(raw).length>32768)return json({ok:false,error:"BODY_TOO_LARGE"},413);
  let body={};try{body=raw?JSON.parse(raw):{}}catch{return json({ok:false,error:"BAD_JSON"},400)}
  try{const advisory=await runNemotronAdvisory(env,body?.receipt||body,"governance-service-binding");return json({ok:true,selftest:"nemotron-autonomic-maintenance-v1",primary_model:PRIMARY_MODEL,advisory,free_first:true,paid_budget_usd:0,secrets_redacted:true})}catch(error){return json({ok:false,selftest:"nemotron-autonomic-maintenance-v1",primary_model:PRIMARY_MODEL,error:safe(error?.message||error),free_first:true,paid_budget_usd:0,secrets_redacted:true},502)}
}

export async function runScheduledAutonomicPulse(env){
  const latest=await stateGet(env);const unhealthy=latest?.ok===false||latest?.status==="degraded"||latest?.status==="persistent_failure"||Number(latest?.failure_streak||0)>0;
  if(!unhealthy)return{ok:true,skipped:true,reason:"HEALTHY",model:PRIMARY_MODEL};
  try{return await runNemotronAdvisory(env,latest,"scheduled-health-failure")}catch(error){console.log(JSON.stringify({event:"nemotron-autonomic-pulse-failed",error:safe(error?.message||error),secrets_redacted:true}));return{ok:false,error:safe(error?.message||error),model:PRIMARY_MODEL}}
}

export const AUTONOMIC_MODEL_POLICY=Object.freeze({primary_model:PRIMARY_MODEL,review_model:REVIEW_MODEL,free_first:true,paid_budget_usd:0,tools:false,web:false,production_mutation:false});
