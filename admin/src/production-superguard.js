import superguard,{AdminCoordinator} from "./superguard.js";
import {tencentExecutorStatus,tencentExecutorSelftest,tencentAgentInvoke} from "./tencent-executor.js";
export {AdminCoordinator};
const H={"content-type":"application/json;charset=utf-8","cache-control":"no-store"};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const fail=(c,m,s=409,d)=>json({ok:false,error:c,message:m,...(d?{details:d}:{})},s);
const tok=req=>{const h=req.headers.get("authorization")||"";return h.startsWith("Bearer ")?h.slice(7).trim():""};
function eq(a,b){a=String(a||"");b=String(b||"");if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
async function auth(req,env){if(!env.ADMIN_GPT_TOKEN)throw Object.assign(new Error("ADMIN_TOKEN_NOT_CONFIGURED"),{status:503});if(!eq(tok(req),env.ADMIN_GPT_TOKEN))throw Object.assign(new Error("UNAUTHORIZED"),{status:401})}
function deployProbeToken(){return typeof TENCENT_DEPLOY_E2E_PROBE==="string"?TENCENT_DEPLOY_E2E_PROBE:""}
function productionAttestedCommit(){return typeof TENCENT_PRODUCTION_E2E_ATTESTED==="string"?TENCENT_PRODUCTION_E2E_ATTESTED:""}
function productionFailureCode(){return typeof TENCENT_PRODUCTION_E2E_FAILURE==="string"?TENCENT_PRODUCTION_E2E_FAILURE:""}
function productionFailedCommit(){return typeof TENCENT_PRODUCTION_E2E_FAILED_COMMIT==="string"?TENCENT_PRODUCTION_E2E_FAILED_COMMIT:""}
function productionTencentFailed(){return Boolean(productionFailureCode())}

async function deployTencentE2E(req,env){
  const expected=deployProbeToken(),provided=req.headers.get("x-tencent-deploy-probe")||"";
  if(!expected||!eq(provided,expected))return new Response(null,{status:404,headers:{"cache-control":"no-store"}});
  const response=await tencentExecutorSelftest(env);
  const headers=new Headers(response.headers);
  headers.set("cache-control","no-store");
  headers.set("x-deploy-e2e","tencent-runtime-v1");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

async function oneShotTencentRuntime(env){
  const response=await tencentExecutorSelftest(env);
  const body=await response.json().catch(()=>({}));
  const diag=body?.active?.context_diag||null;
  const checks=Array.isArray(body?.checks)?body.checks.map(x=>({name:String(x?.name||""),ok:x?.ok===true})):[];
  const safeDiag=diag?{
    context_type:String(diag.context_type||"")||null,
    tools_present:diag.tools_present===true,
    tools_type:String(diag.tools_type||"")||null,
    tools_all_callable:diag.tools_all_callable===true,
    sandbox_present:diag.sandbox_present===true,
    sandbox_type:String(diag.sandbox_type||"")||null,
    sandbox_commands_present:diag.sandbox_commands_present===true,
    sandbox_files_present:diag.sandbox_files_present===true,
    sandbox_browser_present:diag.sandbox_browser_present===true,
    sandbox_run_code_callable:diag.sandbox_run_code_callable===true
  }:null;
  return json({
    ok:body?.ok===true,
    provider:"tencent-edgeone-makers",
    validation:body?.validation||"FAIL",
    selftest:body?.selftest||"executor-runtime-v5",
    checks,
    context_diag:safeDiag,
    health_ok:body?.health?.ok===true,
    health_revision:String(body?.health?.runtime_revision||"")||null,
    capability_tool_count:Number(body?.capabilities?.tool_count||0),
    active_validation:body?.active?.validation||null,
    error:body?.error?String(body.error).slice(0,160):null,
    fail_closed:true,
    secrets_redacted:true,
    one_shot:true
  },response.status);
}

function tencentProductionAttestation(){
  const commit=productionAttestedCommit();
  if(/^[a-f0-9]{40,64}$/i.test(commit))return json({
    ok:true,
    provider:"tencent-edgeone-makers",
    role:"agent-executor",
    validation:"PASS",
    runtime_e2e:true,
    selftest:"executor-runtime-v5",
    attested_commit:commit,
    checks_required:15,
    stable_domain_required:true,
    shell_file_python_chromium_required:true,
    fail_closed:true,
    secret_values_exposed:false,
    deploy_probe_active:Boolean(deployProbeToken())
  });
  const failure=productionFailureCode(),failedCommit=productionFailedCommit();
  if(failure&&/^[a-f0-9]{40,64}$/i.test(failedCommit))return json({
    ok:false,
    provider:"tencent-edgeone-makers",
    role:"agent-executor",
    validation:"FAIL",
    runtime_e2e:false,
    selftest:"executor-runtime-v5",
    failed_commit:failedCommit,
    failure_code:failure,
    production_routing:false,
    agent_execution_enabled:false,
    fail_closed:true,
    secret_values_exposed:false,
    deploy_probe_active:Boolean(deployProbeToken())
  });
  return new Response(null,{status:404,headers:{"cache-control":"no-store"}});
}

async function literatureSelftest(req,env){
  await auth(req,env);
  const svc=env.INTELLIGENCE_CENTER;
  if(!svc?.fetch)return fail("CENTER_UNCONFIGURED","intelligence service binding is not configured",503);
  const started=Date.now(),c=new AbortController(),timer=setTimeout(()=>c.abort(),60000);
  try{
    const r=await svc.fetch(new Request("https://intelligence.internal/v1/selftest/literature",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:"{}",signal:c.signal})),body=await r.json().catch(()=>null),ok=r.ok&&body?.ok===true;
    return json({ok,center:"intelligence",suite:"literature-production-keys",http_status:r.status,business_e2e:body?.business_e2e===true,selftest:body,elapsed_ms:Date.now()-started},ok?200:(r.status||503));
  }catch(e){return fail(e?.name==="AbortError"?"SELFTEST_TIMEOUT":"SELFTEST_FAILED",String(e?.message||e),e?.name==="AbortError"?504:502,{center:"intelligence",suite:"literature-production-keys",elapsed_ms:Date.now()-started})}
  finally{clearTimeout(timer)}
}

export default{async fetch(req,env,ctx){try{
  const u=new URL(req.url);
  if(req.method==="GET"&&u.pathname==="/_diag/tencent-runtime-4pN8sQw2")return await oneShotTencentRuntime(env);
  if(req.method==="POST"&&u.pathname==="/_internal/tencent-deploy-e2e")return await deployTencentE2E(req,env);
  if(req.method==="GET"&&u.pathname==="/_internal/tencent-production-attestation")return tencentProductionAttestation();
  if(req.method==="POST"&&u.pathname==="/v1/admin/selftest/literature")return await literatureSelftest(req,env);
  if(req.method==="GET"&&u.pathname==="/v1/admin/tencent/status"){await auth(req,env);return await tencentExecutorStatus(env)}
  if(req.method==="POST"&&u.pathname==="/v1/admin/tencent/selftest"){await auth(req,env);return await tencentExecutorSelftest(env)}
  if(req.method==="POST"&&u.pathname==="/v1/admin/tencent/agent"){
    await auth(req,env);
    if(productionTencentFailed())return fail("TENCENT_PRODUCTION_E2E_NOT_PASSED","Tencent executor remains fail-closed until production E2E passes",503,{failed_commit:productionFailedCommit()||null});
    return await tencentAgentInvoke(req,env)
  }
  return await superguard.fetch(req,env,ctx)
}catch(e){return fail(String(e?.message||"INTERNAL_ERROR"),e?.status>=500?"Internal operation failed":String(e?.message||"Request failed"),e?.status||500,e?.details)}}};