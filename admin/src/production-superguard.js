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

const BUILD_DIAGNOSTIC_TOKEN_SHA256="e423046aeb737eacf553e1197cf3e758a03797518840812ae7bcf6d8f028f125";
async function sha256(v){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(v||"")));return[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function buildDiagnosticAuthorized(req){const v=(req.headers.get("x-build-diagnostic-token")||"").trim();return Boolean(v)&&eq(await sha256(v),BUILD_DIAGNOSTIC_TOKEN_SHA256)}
function scrubLogLine(v){
  let s=String(v??"").slice(0,1200);
  s=s.replace(/Bearer\s+[^\s"']+/gi,"Bearer [REDACTED]");
  s=s.replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)[^\s,"']+/gi,"$1[REDACTED]");
  s=s.replace(/\b[A-Za-z0-9_-]{36,}\b/g,m=>/^[a-f0-9]{40,64}$/i.test(m)?m:"[REDACTED_LONG]");
  return s;
}
async function cfBuildApi(env,path){
  if(!env.CF_ACCOUNT_ID||!env.CF_API_TOKEN)throw Object.assign(new Error("CF_API_NOT_CONFIGURED"),{status:503});
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}${path}`,{headers:{authorization:`Bearer ${env.CF_API_TOKEN}`,accept:"application/json"}});
  const x=await r.json().catch(()=>null);
  if(!r.ok||x?.success===false){const e=Object.assign(new Error("CLOUDFLARE_BUILDS_API_ERROR"),{status:r.status||502,cf_status:r.status,cf_errors:Array.isArray(x?.errors)?x.errors.slice(0,5).map(z=>({code:z?.code??null,message:scrubLogLine(z?.message||"")})):[]});throw e}
  return x;
}
function buildArray(x){if(Array.isArray(x?.result))return x.result;if(Array.isArray(x?.result?.builds))return x.result.builds;if(x?.result?.builds&&typeof x.result.builds==="object")return Object.values(x.result.builds);return[]}
async function cloudflareBuildDiagnostic(req,env){
  if(!await buildDiagnosticAuthorized(req))return new Response(null,{status:404,headers:{"cache-control":"no-store"}});
  try{
    const scripts=await cfBuildApi(env,"/workers/scripts");
    const script=(Array.isArray(scripts?.result)?scripts.result:[]).find(x=>x?.id==="compute-worker");
    if(!script?.tag)return fail("COMPUTE_WORKER_TAG_NOT_FOUND","compute-worker tag was not returned by Cloudflare",502);
    const list=await cfBuildApi(env,`/builds/workers/${encodeURIComponent(script.tag)}/builds`);
    const builds=buildArray(list).sort((a,b)=>String(b?.created_on||"").localeCompare(String(a?.created_on||""))).slice(0,8);
    const clean=builds.map(b=>({build_uuid:b?.build_uuid||null,status:b?.status||null,build_outcome:b?.build_outcome||null,created_on:b?.created_on||null,running_on:b?.running_on||null,stopped_on:b?.stopped_on||null,branch:b?.build_trigger_metadata?.branch||null,commit_hash:b?.build_trigger_metadata?.commit_hash||null,trigger_source:b?.build_trigger_metadata?.build_trigger_source||null,repo_name:b?.build_trigger_metadata?.repo_name||null}));
    const target=builds.find(b=>b?.build_outcome==="fail")||builds[0]||null;
    let log_tail=[];
    if(target?.build_uuid){
      const logs=await cfBuildApi(env,`/builds/builds/${encodeURIComponent(target.build_uuid)}/logs`);
      const lines=Array.isArray(logs?.result?.lines)?logs.result.lines:[];
      log_tail=lines.slice(-100).map(row=>Array.isArray(row)?{at:row[0]??null,line:scrubLogLine(row[row.length-1])}:{at:null,line:scrubLogLine(row)});
    }
    return json({ok:true,provider:"cloudflare-workers-builds",script:"compute-worker",workers_ci_read:true,builds:clean,diagnostic_build_uuid:target?.build_uuid||null,log_tail,truncated:Boolean(log_tail.length>=100),secrets_redacted:true});
  }catch(e){return json({ok:false,error:String(e?.message||"BUILD_DIAGNOSTIC_FAILED"),http_status:e?.status||502,cloudflare_http_status:e?.cf_status||null,cloudflare_errors:e?.cf_errors||[],workers_ci_read:false,secrets_redacted:true},e?.status>=400&&e?.status<600?e.status:502)}
}

async function deployTencentE2E(req,env){
  const expected=deployProbeToken(),provided=req.headers.get("x-tencent-deploy-probe")||"";
  if(!expected||!eq(provided,expected))return new Response(null,{status:404,headers:{"cache-control":"no-store"}});
  const response=await tencentExecutorSelftest(env);
  const headers=new Headers(response.headers);
  headers.set("cache-control","no-store");
  headers.set("x-deploy-e2e","tencent-runtime-v1");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
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
  if(req.method==="GET"&&u.pathname==="/_internal/cloudflare-build-diagnostic")return await cloudflareBuildDiagnostic(req,env);
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