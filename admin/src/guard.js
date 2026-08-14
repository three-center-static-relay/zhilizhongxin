import base, { AdminCoordinator } from "./index.js";
export { AdminCoordinator };

const H={"content-type":"application/json;charset=utf-8","cache-control":"no-store"};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const redact=v=>{if(Array.isArray(v))return v.map(redact);if(v&&typeof v==="object"){const o={};for(const[k,x]of Object.entries(v))o[k]=/token|secret|password|authorization|cookie|api.?key/i.test(k)?"[REDACTED]":redact(x);return o}return v};
const fail=(c,m,s=409,d)=>json({ok:false,error:c,message:m,...(d?{details:redact(d)}:{})},s);
const token=req=>{const h=req.headers.get("authorization")||"";return h.startsWith("Bearer ")?h.slice(7).trim():""};
function eq(a,b){a=String(a||"");b=String(b||"");if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
function state(env){return env.ADMIN_COORDINATOR.get(env.ADMIN_COORDINATOR.idFromName("global"))}
async function sc(env,path,method="GET",data){const init={method,headers:{"content-type":"application/json"}};if(data!==undefined)init.body=JSON.stringify(data);const r=await state(env).fetch(new Request(`https://state.internal${path}`,init));const x=await r.json().catch(()=>({ok:false,error:"STATE_BAD_RESPONSE"}));if(!r.ok)throw Object.assign(new Error(x.error||"STATE_ERROR"),{status:r.status,details:x});return x}
async function cf(env,path){if(!env.CF_ACCOUNT_ID||!env.CF_API_TOKEN)throw Object.assign(new Error("CF_API_NOT_CONFIGURED"),{status:503});const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}${path}`,{headers:{authorization:`Bearer ${env.CF_API_TOKEN}`,accept:"application/json"}});const x=await r.json().catch(()=>null);if(!r.ok||x?.success===false)throw Object.assign(new Error("CLOUDFLARE_API_ERROR"),{status:502,details:x});return x}
async function current(env,s){const d=await cf(env,`/workers/scripts/${encodeURIComponent(s)}/deployments`),ds=d?.result?.deployments||d?.result||[];for(const dep of ds){const vs=dep?.versions||[],v=vs.find(x=>Number(x.percentage)===100)||vs[0];if(v?.version_id)return v.version_id}return null}
async function previous(env,s,cur){const d=await cf(env,`/workers/scripts/${encodeURIComponent(s)}/deployments`),ds=d?.result?.deployments||d?.result||[];for(const dep of ds.slice(1)){const vs=dep?.versions||[],v=vs.find(x=>Number(x.percentage)===100)||vs[0];if(v?.version_id&&v.version_id!==cur)return v.version_id}return null}
const ts=x=>{const n=Date.parse(x||"");return Number.isFinite(n)?n:0};
async function audit(env,rec){try{await sc(env,"/audit","POST",{at:new Date().toISOString(),...redact(rec)})}catch{}}

async function promote(req,env){
  if(!env.ADMIN_GPT_TOKEN)return fail("ADMIN_TOKEN_NOT_CONFIGURED","Admin token is not configured",503);
  if(!eq(token(req),env.ADMIN_GPT_TOKEN))return fail("UNAUTHORIZED","Unauthorized",401);
  const b=await req.json().catch(()=>({}));
  const c=(await sc(env,"/candidate")).candidate;
  if(!c)return fail("NO_CANDIDATE","No candidate",404);
  if(!c.validated||!c.approved)return fail("CANDIDATE_NOT_READY","Candidate must be validated and approved",409);
  const center=String(b.center||"all"),a=(await sc(env,`/acceptance/${encodeURIComponent(center)}`).catch(()=>({acceptance:null}))).acceptance;
  if(!a||a.status!=="pass")return fail("ACCEPTANCE_REQUIRED","Passing acceptance required",409);
  const gateTime=Math.max(ts(c.created_at),ts(c.validated_at));
  if(!gateTime||ts(a.finished_at)<gateTime)return fail("STALE_ACCEPTANCE","Acceptance predates the current candidate validation",409,{candidate_created_at:c.created_at,candidate_validated_at:c.validated_at,acceptance_finished_at:a.finished_at});
  if(b.acceptance_run_id&&String(b.acceptance_run_id)!==String(a.run_id))return fail("ACCEPTANCE_RUN_MISMATCH","acceptance_run_id does not match the passing acceptance",409,{latest_run_id:a.run_id});
  const cur=await current(env,c.script);
  if(cur!==c.version_id)return fail("CANDIDATE_VERSION_MISMATCH","The tested candidate is not the active Worker version",409,{active_version:cur,candidate_version:c.version_id});
  if(b.expected_current_version&&String(b.expected_current_version)!==String(cur))return fail("VERSION_CONFLICT","Production moved",409,{current:cur});
  const rollback=await previous(env,c.script,cur);
  const nc={...c,test_passed:true,promoted:true,promoted_at:new Date().toISOString(),accepted_run_id:a.run_id,accepted_receipt:a.receipt_digest||null,production_version:cur,rollback_target:rollback||c.rollback_target||null};
  await sc(env,"/candidate","POST",nc);
  await audit(env,{action:"deploy.accept-active",script:c.script,version_id:cur,acceptance_run_id:a.run_id,rollback_target:nc.rollback_target});
  return json({ok:true,already_active:true,production_version:cur,acceptance_run_id:a.run_id,receipt_digest:a.receipt_digest||null,rollback_target:nc.rollback_target});
}

export default {
  async fetch(req,env,ctx){
    try{
      const u=new URL(req.url);
      if(req.method==="POST"&&u.pathname==="/v1/admin/deploy/promote")return await promote(req,env);
      return await base.fetch(req,env,ctx);
    }catch(e){
      await audit(env,{action:"guard.error",path:new URL(req.url).pathname,error:String(e?.message||e)});
      return fail(String(e?.message||"INTERNAL_ERROR"),e?.status>=500?"Internal operation failed":String(e?.message||"Request failed"),e?.status||500,e?.details);
    }
  }
};
