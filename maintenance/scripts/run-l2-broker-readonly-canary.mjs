#!/usr/bin/env node
import {spawn} from "node:child_process";
import {mkdirSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const PORT=8801;
const READY_TIMEOUT_MS=45000;
const REQUEST_TIMEOUT_MS=15000;
const MAX_ATTEMPTS=3;
const RETRY_DELAY_MS=4000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
function classify(message){const m=String(message||"").toLowerCase();if(m.includes("wrangler_dev_exited"))return"WRANGLER_DEV_EXITED";if(m.includes("driver_not_ready")||m.includes("econnrefused"))return"DRIVER_NOT_READY";if(m.includes("abort")||m.includes("timeout")||m.includes("timed out"))return"RPC_TIMEOUT";if(m.includes("binding")||m.includes("fetch failed")||m.includes("network"))return"SERVICE_BINDING_TRANSPORT";return"ADMIN_DEFAULT_FETCH_FAILED"}
function stop(child){if(!child||child.exitCode!==null)return;const grouped=process.platform!=="win32"&&Number.isInteger(child.pid);try{if(grouped)process.kill(-child.pid,"SIGTERM");else child.kill("SIGTERM")}catch{}setTimeout(()=>{if(child.exitCode!==null)return;try{if(grouped)process.kill(-child.pid,"SIGKILL");else child.kill("SIGKILL")}catch{}},1500).unref?.()}
async function requestLocal(path,init={},timeoutMs=5000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(`http://127.0.0.1:${PORT}${path}`,{...init,signal:controller.signal});const body=await response.json().catch(()=>null);return{response,body}}finally{clearTimeout(timer)}}
async function waitReady(child){const deadline=Date.now()+READY_TIMEOUT_MS;let last=null;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`WRANGLER_DEV_EXITED:${child.exitCode}`);try{const{response,body}=await requestLocal("/ready");if(response.ok&&body?.ok===true)return}catch(error){last=error}await sleep(1000)}throw last||new Error("ADMIN_DEFAULT_DRIVER_NOT_READY")}
async function main(){
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  const dir=resolve(".l2-broker-readonly-canary");
  const wranglerBin=resolve("node_modules/.bin/wrangler");
  rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"driver.mjs"),`export default{async fetch(request,env){const u=new URL(request.url);if(request.method==="GET"&&u.pathname==="/ready")return Response.json({ok:true});if(request.method!=="POST"||u.pathname!=="/run")return Response.json({ok:false,error_code:"NOT_FOUND"},{status:404});try{const r=await env.ADMIN_DEFAULT.fetch(new Request("https://admin.internal/health",{method:"GET",headers:{accept:"application/json"}}));const body=await r.json().catch(()=>null);const ok=r.ok&&body?.ok===true;return Response.json({ok,error_code:ok?null:"ADMIN_HEALTH_NOT_OK",admin_default_fetch:true,http_status:r.status,secrets_redacted:true},{status:ok?200:502})}catch(error){const m=String(error?.message||error).toLowerCase();let error_code="ADMIN_DEFAULT_FETCH_FAILED";if(m.includes("timeout")||m.includes("abort"))error_code="RPC_TIMEOUT";else if(m.includes("binding")||m.includes("fetch failed")||m.includes("network"))error_code="SERVICE_BINDING_TRANSPORT";return Response.json({ok:false,error_code,admin_default_fetch:false,secrets_redacted:true},{status:502})}}};\n`);
  writeFileSync(resolve(dir,"wrangler.jsonc"),JSON.stringify({name:"l2-admin-default-canary",main:"driver.mjs",compatibility_date:"2026-08-20",compatibility_flags:["nodejs_compat"],services:[{binding:"ADMIN_DEFAULT",service:"admin-worker"}]},null,2));
  emit({event:"L2_ADMIN_DEFAULT_CANARY_START",phase:"remote-admin-default-start",commit_sha:commit||null,max_attempts:MAX_ATTEMPTS,remote_development:true,admin_named_entrypoint_bypassed:true,ai_gateway_bypassed:true,production_worker_traffic_changed:false,dynamic_route_mutation:false});
  let child=null,last={error_code:"NOT_ATTEMPTED",attempt:0};
  try{
    child=spawn(wranglerBin,["dev","--remote","--config","wrangler.jsonc","--ip","127.0.0.1","--port",String(PORT)],{cwd:dir,env:{...process.env,CI:"1",NO_COLOR:"1",WRANGLER_SEND_METRICS:"false"},detached:process.platform!=="win32",stdio:["ignore","ignore","ignore"]});
    await waitReady(child);emit({event:"L2_ADMIN_DEFAULT_DRIVER_READY",phase:"remote-admin-default-ready"});
    for(let attemptNumber=1;attemptNumber<=MAX_ATTEMPTS;attemptNumber++){
      try{const{response,body}=await requestLocal("/run",{method:"POST",headers:{accept:"application/json"}},REQUEST_TIMEOUT_MS);if(response.ok&&body?.ok===true){emit({event:"L2_ADMIN_DEFAULT_CANARY_PASS",phase:"remote-admin-default-pass",attempt:attemptNumber,error_code:null,admin_default_fetch:true,http_status:body?.http_status??null,admin_named_entrypoint_bypassed:true,ai_gateway_bypassed:true,dynamic_route_mutation:false,production_worker_traffic_changed:false});return}last={error_code:String(body?.error_code||`ADMIN_DEFAULT_HTTP_${response.status}`),attempt:attemptNumber}}catch(error){last={error_code:classify(error?.message||error),attempt:attemptNumber}}
      emit({event:"L2_ADMIN_DEFAULT_CANARY_RETRY",phase:"remote-admin-default-retry",attempt:attemptNumber,error_code:last.error_code,dynamic_route_mutation:false});if(attemptNumber<MAX_ATTEMPTS)await sleep(RETRY_DELAY_MS)
    }
    throw Object.assign(new Error(last.error_code||"ADMIN_DEFAULT_CANARY_EXHAUSTED"),{error_code:last.error_code,attempt:last.attempt});
  }catch(error){const error_code=String(error?.error_code||classify(error?.message||error));emit({event:"L2_ADMIN_DEFAULT_CANARY_FAIL",phase:"remote-admin-default-fail",error_code,attempt:error?.attempt??last.attempt??0,admin_named_entrypoint_bypassed:true,ai_gateway_bypassed:true,dynamic_route_mutation:false,production_worker_traffic_changed:false},process.stderr);process.exitCode=1}
  finally{stop(child);await sleep(1800);rmSync(dir,{recursive:true,force:true})}
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main();
