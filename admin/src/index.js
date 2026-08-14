const SERVICE = "admin-worker";
const API_VERSION = "2026-08-14.2";
const JSON_HEADERS = {"content-type":"application/json;charset=utf-8","cache-control":"no-store"};
const MAX_AUDIT = 300;

function json(x, status = 200) {
  return new Response(JSON.stringify(x), {status, headers: JSON_HEADERS});
}
function err(code, message, status = 400, details) {
  return json({ok:false,error:code,message,...(details ? {details:redact(details)} : {})}, status);
}
function now(){ return new Date().toISOString(); }
function rid(){ return crypto.randomUUID(); }
function int(v,d){ const n=Number(v); return Number.isFinite(n)?Math.trunc(n):d; }
function redact(v){
  if(Array.isArray(v)) return v.map(redact);
  if(v && typeof v === "object"){
    const o={};
    for(const [k,x] of Object.entries(v)) o[k]=/token|secret|password|authorization|cookie|api.?key/i.test(k)?"[REDACTED]":redact(x);
    return o;
  }
  return v;
}
async function body(req,max=65536){
  const n=Number(req.headers.get("content-length")||0);
  if(n>max) throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  const t=await req.text();
  if(new TextEncoder().encode(t).length>max) throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  if(!t) return {};
  try{return JSON.parse(t)}catch{throw Object.assign(new Error("INVALID_REQUEST"),{status:400})}
}
function bearer(req){const h=req.headers.get("authorization")||"";return h.startsWith("Bearer ")?h.slice(7).trim():""}
function secureEq(a,b){a=String(a||"");b=String(b||"");if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}

function binding(env,n){
  return {governance:env.GOVERNANCE_CENTER,intelligence:env.INTELLIGENCE_CENTER,compute:env.COMPUTE_CENTER,expert:env.EXPERT_CENTER}[n]||null;
}
function centerForScript(script){
  return {"governance-worker":"governance","intelligence-worker":"intelligence","compute-worker":"compute","expert-worker":"expert"}[script]||null;
}
async function center(env,n,path,init={}){
  const b=binding(env,n);
  if(!b?.fetch) throw Object.assign(new Error("CENTER_UNCONFIGURED"),{status:503});
  const c=new AbortController(), t=setTimeout(()=>c.abort(),int(env.CENTER_TIMEOUT_MS,8000));
  try{
    const r=await b.fetch(new Request(`https://${n}.internal${path}`,{...init,headers:{accept:"application/json",...(init.headers||{})},signal:c.signal}));
    const text=await r.text();
    let x; try{x=text?JSON.parse(text):null}catch{x=text.slice(0,2000)}
    return {ok:r.ok,http_status:r.status,body:redact(x)};
  } finally { clearTimeout(t); }
}
async function allHealth(env){
  const out={};
  await Promise.all(["governance","intelligence","compute","expert"].map(async n=>{
    try{out[n]=await center(env,n,"/health")}catch(e){out[n]={ok:false,error:String(e.message)}}
  }));
  return {ok:Object.values(out).every(x=>x.ok),checked_at:now(),centers:out};
}

function state(env){return env.ADMIN_COORDINATOR.get(env.ADMIN_COORDINATOR.idFromName("global"))}
async function stateCall(env,path,method="GET",data){
  const init={method,headers:{"content-type":"application/json"}};
  if(data!==undefined) init.body=JSON.stringify(data);
  const r=await state(env).fetch(new Request(`https://state.internal${path}`,init));
  const x=await r.json().catch(()=>({ok:false,error:"STATE_BAD_RESPONSE"}));
  if(!r.ok) throw Object.assign(new Error(x.error||"STATE_ERROR"),{status:r.status,details:x});
  return x;
}
async function audit(env,rec){try{await stateCall(env,"/audit","POST",{at:now(),...redact(rec)})}catch{}}
function managed(env,s){
  const a=String(env.MANAGED_SCRIPTS||"admin-worker,governance-worker,intelligence-worker,compute-worker,expert-worker,maintenance-worker").split(",").map(x=>x.trim()).filter(Boolean);
  if(!a.includes(s)) throw Object.assign(new Error("SCRIPT_NOT_MANAGED"),{status:403});
  return a;
}
async function cf(env,path,init={}){
  if(!env.CF_ACCOUNT_ID||!env.CF_API_TOKEN) throw Object.assign(new Error("CF_API_NOT_CONFIGURED"),{status:503});
  const h={authorization:`Bearer ${env.CF_API_TOKEN}`,accept:"application/json","content-type":"application/json",...(init.headers||{})};
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}${path}`,{...init,headers:h});
  const x=await r.json().catch(()=>null);
  if(!r.ok||x?.success===false) throw Object.assign(new Error("CLOUDFLARE_API_ERROR"),{status:502,details:x});
  return x;
}
async function versions(env,s){managed(env,s);return cf(env,`/workers/scripts/${encodeURIComponent(s)}/versions?deployable=true&per_page=20`)}
async function version(env,s,v){managed(env,s);return cf(env,`/workers/scripts/${encodeURIComponent(s)}/versions/${encodeURIComponent(v)}`)}
async function deployments(env,s){managed(env,s);return cf(env,`/workers/scripts/${encodeURIComponent(s)}/deployments`)}
async function deploy(env,s,v,msg){
  managed(env,s);
  return cf(env,`/workers/scripts/${encodeURIComponent(s)}/deployments`,{method:"POST",body:JSON.stringify({strategy:"percentage",versions:[{version_id:v,percentage:100}],annotations:{"workers/message":String(msg||"").slice(0,900)}})});
}
async function currentVersion(env,s){
  const d=await deployments(env,s), ds=d?.result?.deployments||d?.result||[];
  for(const dep of ds){const vs=dep?.versions||[];const v=vs.find(x=>Number(x.percentage)===100)||vs[0];if(v?.version_id)return v.version_id}
  return null;
}
async function latestPrevious(env,s){
  const d=await deployments(env,s), ds=d?.result?.deployments||d?.result||[];
  let current=null;
  if(ds[0]){const vs=ds[0]?.versions||[];current=(vs.find(x=>Number(x.percentage)===100)||vs[0])?.version_id||null}
  for(const dep of ds.slice(1)){const vs=dep?.versions||[];const v=vs.find(x=>Number(x.percentage)===100)||vs[0];if(v?.version_id&&v.version_id!==current)return v.version_id}
  return null;
}

async function auth(req,env){
  if(!env.ADMIN_GPT_TOKEN) throw Object.assign(new Error("ADMIN_TOKEN_NOT_CONFIGURED"),{status:503});
  if(!secureEq(bearer(req),env.ADMIN_GPT_TOKEN)) throw Object.assign(new Error("UNAUTHORIZED"),{status:401});
  const r=await stateCall(env,"/rate","POST",{limit:int(env.RATE_LIMIT_PER_MIN,120)});
  if(!r.ok) throw Object.assign(new Error("RATE_LIMITED"),{status:429,details:r});
}
async function acquire(env,owner,kind){return stateCall(env,"/lock/acquire","POST",{owner,kind,ttl_seconds:int(env.LOCK_TTL_SECONDS,1800)})}
async function release(env,owner){try{await stateCall(env,"/lock/release","POST",{owner})}catch{}}
async function context(env){
  const h=await allHealth(env), lock=await stateCall(env,"/lock"), cand=await stateCall(env,"/candidate");
  const centers={};
  for(const n of ["intelligence","compute","expert","governance"]) centers[n]={health:h.centers[n]?.ok?"ready":"fail",source_digest:h.centers[n]?.body?.source_digest||null};
  return {system_state:h.ok?"ready":"degraded",constitution_version:API_VERSION,active_task:lock.lock||null,centers,candidate:redact(cand.candidate||null)};
}
async function isCancelled(env,runId){
  const t=await stateCall(env,`/task/${encodeURIComponent(runId)}`).catch(()=>({task:null}));
  return t.task?.cancel_requested===true;
}

async function runAcceptance(env,runId,spec,owner){
  let snapshot=null;
  try{
    const cand=(await stateCall(env,"/candidate")).candidate;
    if(!cand) throw new Error("NO_CANDIDATE");
    if(!cand.validated) throw new Error("CANDIDATE_NOT_VALIDATED");
    const current=await currentVersion(env,cand.script);kºwµç