#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER_VERSION="4.123.0";
const ACCOUNT_ID="e3aec027af13c557bbcb831d29c1e7b4";
const WORKERS_DEV_SUBDOMAIN="a15280020511";
const FETCH_ATTEMPTS=8;
const FETCH_TIMEOUT_MS=10000;
const RETRY_DELAY_MS=2500;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
function clean(v,max=100){return String(v??"").replace(/[^0-9A-Za-z._:-]/g,"_").slice(0,max)}
function deploymentEnv(env=process.env){const next={...env,CI:"1",NO_COLOR:"1",WRANGLER_SEND_METRICS:"false"};delete next.WRANGLER_CI_OVERRIDE_NAME;return next}
function runWrangler(args,{cwd,env,input}={}){return spawnSync("npx",["--yes",`wrangler@${WRANGLER_VERSION}`,...args],{cwd,env:env||deploymentEnv(),encoding:"utf8",input,maxBuffer:2*1024*1024})}
function workerUrl(name,output=""){const m=String(output||"").match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i);return m?.[0]||`https://${name}.${WORKERS_DEV_SUBDOMAIN}.workers.dev`}
async function fetchJson(url,init={},timeoutMs=FETCH_TIMEOUT_MS){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{...init,signal:c.signal}),body=await r.json().catch(()=>null);return{r,body}}finally{clearTimeout(t)}}
async function deleteDiagnostic(dir,name,env){for(let attempt=1;attempt<=2;attempt++){const result=runWrangler(["delete","--name",name,"--config","wrangler.jsonc"],{cwd:dir,env,input:"y\n"});if(!result.error&&result.status===0)return{ok:true,attempt};if(attempt<2)await sleep(1500)}return{ok:false}}

async function main(){
  const sha=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!/^[a-f0-9]{40,64}$/i.test(sha))throw new Error("VALID_COMMIT_SHA_REQUIRED");
  const short=sha.slice(0,10).toLowerCase(),name=`l2-admin-probe-${short}`,dir=mkdtempSync(join(tmpdir(),"l2-admin-probe-")),env=deploymentEnv();
  let deployed=false,passed=false,cleanup={ok:true,skipped:true};
  try{
    writeFileSync(join(dir,"worker.mjs"),`export default{async fetch(request,env){const u=new URL(request.url);if(u.pathname==="/health")return Response.json({ok:true,probe:true});if(u.pathname!=="/run")return Response.json({ok:false,error_code:"NOT_FOUND"},{status:404});try{const response=await env.ADMIN_DEFAULT.fetch(new Request("https://admin.internal/health",{method:"GET",headers:{accept:"application/json"}}));const body=await response.json().catch(()=>null);const ok=response.ok&&body?.ok===true;return Response.json({ok,error_code:ok?null:"ADMIN_HEALTH_NOT_OK",admin_default_fetch:true,http_status:response.status,secrets_redacted:true},{status:ok?200:502})}catch{return Response.json({ok:false,error_code:"SERVICE_BINDING_FETCH_FAILED",admin_default_fetch:false,secrets_redacted:true},{status:502})}}};\n`);
    writeFileSync(join(dir,"wrangler.jsonc"),JSON.stringify({name,main:"worker.mjs",account_id:ACCOUNT_ID,compatibility_date:"2026-08-20",workers_dev:true,preview_urls:false,observability:{enabled:false},services:[{binding:"ADMIN_DEFAULT",service:"admin-worker"}]},null,2));
    emit({event:"L2_DEPLOYED_SERVICE_BINDING_START",phase:"deploy-diagnostic-caller",commit_sha:sha,diagnostic_worker:name,diagnostic_worker_mutated:true,production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false,admin_named_entrypoint_bypassed:true,ai_gateway_bypassed:true});
    const deploy=runWrangler(["deploy","--config","wrangler.jsonc"],{cwd:dir,env});
    if(deploy.error||deploy.status!==0){emit({event:"L2_DEPLOYED_SERVICE_BINDING_FAIL",phase:"diagnostic-deploy-failed",error_code:"DIAGNOSTIC_WORKER_DEPLOY_FAILED",exit_code:deploy.status??1,diagnostic_worker_mutated:false,production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false},process.stderr);process.exitCode=1;return}
    deployed=true;
    const url=workerUrl(name,`${deploy.stdout||""}\n${deploy.stderr||""}`);
    emit({event:"L2_DEPLOYED_SERVICE_BINDING_DEPLOYED",phase:"diagnostic-deployed",diagnostic_worker:name,diagnostic_worker_mutated:true,production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false});
    let lastCode="NOT_ATTEMPTED";
    for(let attempt=1;attempt<=FETCH_ATTEMPTS;attempt++){
      try{const{r,body}=await fetchJson(`${url}/run`,{method:"POST",headers:{accept:"application/json"}});if(r.ok&&body?.ok===true&&body?.admin_default_fetch===true){passed=true;emit({event:"L2_DEPLOYED_SERVICE_BINDING_PASS",phase:"deployed-service-binding-pass",attempt,http_status:body.http_status??null,admin_default_fetch:true,diagnostic_worker_mutated:true,production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false,admin_named_entrypoint_bypassed:true,ai_gateway_bypassed:true});break}lastCode=clean(body?.error_code||`PROBE_HTTP_${r.status}`)}catch(error){lastCode=error?.name==="AbortError"?"DIAGNOSTIC_FETCH_TIMEOUT":"DIAGNOSTIC_FETCH_FAILED"}
      emit({event:"L2_DEPLOYED_SERVICE_BINDING_RETRY",phase:"deployed-service-binding-retry",attempt,error_code:lastCode,diagnostic_worker_mutated:true,production_worker_mutated:false,dynamic_route_mutation:false});if(attempt<FETCH_ATTEMPTS)await sleep(RETRY_DELAY_MS)
    }
    if(!passed){emit({event:"L2_DEPLOYED_SERVICE_BINDING_FAIL",phase:"deployed-service-binding-failed",error_code:lastCode,diagnostic_worker_mutated:true,production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false,admin_named_entrypoint_bypassed:true,ai_gateway_bypassed:true},process.stderr);process.exitCode=1}
  }finally{
    if(deployed)cleanup=await deleteDiagnostic(dir,name,env);
    emit({event:cleanup.ok?"L2_DIAGNOSTIC_WORKER_CLEANUP_PASS":"L2_DIAGNOSTIC_WORKER_CLEANUP_FAIL",phase:cleanup.ok?"diagnostic-cleanup-pass":"diagnostic-cleanup-failed",diagnostic_worker:name,cleanup_ok:cleanup.ok===true,cleanup_attempt:cleanup.attempt??null,production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false},cleanup.ok?process.stdout:process.stderr);
    rmSync(dir,{recursive:true,force:true});
    if(deployed&&!cleanup.ok)process.exitCode=1;
  }
}

const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invoked)main().catch(()=>{emit({event:"L2_DEPLOYED_SERVICE_BINDING_FAIL",phase:"script-failed",error_code:"DIAGNOSTIC_SCRIPT_FAILED",production_worker_mutated:false,production_worker_traffic_changed:false,dynamic_route_mutation:false},process.stderr);process.exitCode=1});
