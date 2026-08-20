#!/usr/bin/env node
import {spawn} from "node:child_process";
import {mkdirSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const PORT=8801;
const READY_TIMEOUT_MS=45000;
const REQUEST_TIMEOUT_MS=20000;
const MAX_ATTEMPTS=4;
const RETRY_DELAY_MS=5000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
function classify(message){const m=String(message||"").toLowerCase();if(m.includes("wrangler_dev_exited"))return"WRANGLER_DEV_EXITED";if(m.includes("driver_not_ready")||m.includes("econnrefused"))return"DRIVER_NOT_READY";if(m.includes("abort")||m.includes("timeout")||m.includes("timed out"))return"RPC_TIMEOUT";if(m.includes("entrypoint")||m.includes("does not implement")||m.includes("not found"))return"ENTRYPOINT_UNAVAILABLE";if(m.includes("permission")||m.includes("forbidden")||m.includes("unauthorized")||m.includes("401")||m.includes("403"))return"AI_GATEWAY_PERMISSION";if(m.includes("binding")||m.includes("rpc")||m.includes("fetch failed")||m.includes("network"))return"RPC_TRANSPORT";return"BROKER_READ_FAILED"}
function stop(child){if(!child||child.exitCode!==null)return;const grouped=process.platform!=="win32"&&Number.isInteger(child.pid);try{if(grouped)process.kill(-child.pid,"SIGTERM");else child.kill("SIGTERM")}catch{}setTimeout(()=>{if(child.exitCode!==null)return;try{if(grouped)process.kill(-child.pid,"SIGKILL");else child.kill("SIGKILL")}catch{}},1500).unref?.()}
async function requestLocal(path,init={},timeoutMs=5000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(`http://127.0.0.1:${PORT}${path}`,{...init,signal:controller.signal});const body=await response.json().catch(()=>null);return{response,body}}finally{clearTimeout(timer)}}
async function waitReady(child){const deadline=Date.now()+READY_TIMEOUT_MS;let last=null;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`WRANGLER_DEV_EXITED:${child.exitCode}`);try{const{response,body}=await requestLocal("/ready");if(response.ok&&body?.ok===true)return}catch(error){last=error}await sleep(1000)}throw last||new Error("BROKER_READONLY_DRIVER_NOT_READY")}
async function main(){
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  const dir=resolve(".l2-broker-readonly-canary");
  const wranglerBin=resolve("node_modules/.bin/wrangler");
  rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"driver.mjs"),`export default{async fetch(request,env){const u=new URL(request.url);if(request.method==="GET"&&u.pathname==="/ready")return Response.json({ok:true});if(request.method!=="POST"||u.pathname!=="/run")return Response.json({ok:false,error_code:"NOT_FOUND"},{status:404});try{const payload=await env.AI_GATEWAY_CONTROL.request({operation:"routes.list"});const ok=payload?.success!==false;const routeCount=Array.isArray(payload?.result)?payload.result.length:null;return Response.json({ok,error_code:ok?null:"BROKER_RETURNED_FAILURE",broker_rpc:true,routes_readable:ok,route_count:routeCount,secrets_redacted:true},{status:ok?200:502})}catch(error){const message=String(error?.message||error).toLowerCase();let error_code="BROKER_RPC_FAILED";if(message.includes("entrypoint")||message.includes("does not implement")||message.includes("not found"))error_code="ENTRYPOINT_UNAVAILABLE";else if(message.includes("permission")||message.includes("forbidden")||message.includes("unauthorized")||message.includes("401")||message.includes("403"))error_code="AI_GATEWAY_PERMISSION";else if(message.includes("timeout")||message.includes("abort"))error_code="RPC_TIMEOUT";else if(message.includes("binding")||message.includes("rpc")||message.includes("fetch failed")||message.includes("network"))error_code="RPC_TRANSPORT";return Response.json({ok:false,error_code,broker_rpc:false,routes_readable:false,secrets_redacted:true},{status:502})}}};\n`);
  writeFileSync(resolve(dir,"wrangler.jsonc"),JSON.stringify({name:"l2-broker-readonly-canary",main:"driver.mjs",compatibility_date:"2026-08-20",compatibility_flags:["nodejs_compat"],services:[{binding:"AI_GATEWAY_CONTROL",service:"admin-worker",entrypoint:"AIGatewayControl"}]},null,2));
  emit({event:"L2_BROKER_READONLY_CANARY_START",phase:"remote-dev-start",commit_sha:commit||null,max_attempts:MAX_ATTEMPTS,remote_development:true,production_worker_traffic_changed:false,dynamic_route_mutation:false});
  let child=null,last={error_code:"NOT_ATTEMPTED",broker_rpc:false,routes_readable:false,attempt:0};
  try{
    child=spawn(wranglerBin,["dev","--remote","--config","wrangler.jsonc","--ip","127.0.0.1","--port",String(PORT)],{cwd:dir,env:{...process.env,CI:"1",NO_COLOR:"1",WRANGLER_SEND_METRICS:"false"},detached:process.platform!=="win32",stdio:["ignore","ignore","ignore"]});
    await waitReady(child);emit({event:"L2_BROKER_READONLY_DRIVER_READY",phase:"remote-driver-ready",broker_rpc:false,routes_readable:false});
    for(let attemptNumber=1;attemptNumber<=MAX_ATTEMPTS;attemptNumber++){
      try{const{response,body}=await requestLocal("/run",{method:"POST",headers:{accept:"application/json"}},REQUEST_TIMEOUT_MS);if(response.ok&&body?.ok===true){emit({event:"L2_BROKER_READONLY_CANARY_PASS",phase:"remote-pass",attempt:attemptNumber,error_code:null,broker_rpc:true,routes_readable:true,route_count:body?.route_count??null,dynamic_route_mutation:false,production_worker_traffic_changed:false});return}last={error_code:String(body?.error_code||`BROKER_READ_HTTP_${response.status}`),broker_rpc:body?.broker_rpc===true,routes_readable:body?.routes_readable===true,attempt:attemptNumber}}catch(error){last={error_code:classify(error?.message||error),broker_rpc:false,routes_readable:false,attempt:attemptNumber}}
      emit({event:"L2_BROKER_READONLY_CANARY_RETRY",phase:"remote-broker-read-retry",attempt:attemptNumber,error_code:last.error_code,broker_rpc:last.broker_rpc,routes_readable:last.routes_readable,dynamic_route_mutation:false});if(attemptNumber<MAX_ATTEMPTS)await sleep(RETRY_DELAY_MS)
    }
    throw Object.assign(new Error(last.error_code||"BROKER_READONLY_CANARY_EXHAUSTED"),{error_code:last.error_code,attempt:last.attempt,broker_rpc:last.broker_rpc,routes_readable:last.routes_readable});
  }catch(error){const error_code=String(error?.error_code||classify(error?.message||error));emit({event:"L2_BROKER_READONLY_CANARY_FAIL",phase:"remote-fail",error_code,attempt:error?.attempt??last.attempt??0,broker_rpc:error?.broker_rpc===true||last.broker_rpc===true,routes_readable:error?.routes_readable===true||last.routes_readable===true,dynamic_route_mutation:false,production_worker_traffic_changed:false},process.stderr);process.exitCode=1}
  finally{stop(child);await sleep(1800);rmSync(dir,{recursive:true,force:true})}
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main();
