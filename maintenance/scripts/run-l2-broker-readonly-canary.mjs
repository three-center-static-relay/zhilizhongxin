#!/usr/bin/env node
import {spawn} from "node:child_process";
import {mkdirSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const PORT=8801;
const READY_TIMEOUT_MS=75000;
const RUN_TIMEOUT_MS=90000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function stop(child){if(!child||child.exitCode!==null)return;try{child.kill("SIGTERM")}catch{}setTimeout(()=>{if(child.exitCode===null)try{child.kill("SIGKILL")}catch{}},1500).unref?.()}
async function requestLocal(path,init={},timeoutMs=5000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(`http://127.0.0.1:${PORT}${path}`,{...init,signal:c.signal});const body=await r.json().catch(()=>null);return{response:r,body}}finally{clearTimeout(t)}}
async function waitReady(child){const deadline=Date.now()+READY_TIMEOUT_MS;let last=null;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`WRANGLER_DEV_EXITED:${child.exitCode}`);try{const {response,body}=await requestLocal("/ready");if(response.ok&&body?.ok===true)return}catch(error){last=error}await sleep(1000)}throw last||new Error("BROKER_READONLY_DRIVER_NOT_READY")}

async function main(){
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  const dir=resolve(".l2-broker-readonly-canary");
  rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"driver.mjs"),`export default{async fetch(request,env){const u=new URL(request.url);if(request.method==="GET"&&u.pathname==="/ready")return Response.json({ok:true});if(request.method!=="POST"||u.pathname!=="/run")return Response.json({ok:false,error:"NOT_FOUND"},{status:404});try{const payload=await env.AI_GATEWAY_CONTROL.request({operation:"routes.list"});const ok=payload?.success!==false;const routeCount=Array.isArray(payload?.result)?payload.result.length:null;return Response.json({ok,broker_rpc:true,routes_readable:ok,route_count:routeCount,secrets_redacted:true},{status:ok?200:502})}catch(error){return Response.json({ok:false,error:String(error?.message||error),details:error?.details||null,secrets_redacted:true},{status:error?.status||502})}}};\n`);
  writeFileSync(resolve(dir,"wrangler.jsonc"),JSON.stringify({name:"l2-broker-readonly-canary",main:"driver.mjs",compatibility_date:"2026-08-20",compatibility_flags:["nodejs_compat"],services:[{binding:"AI_GATEWAY_CONTROL",service:"admin-worker",entrypoint:"AIGatewayControl",remote:true}]},null,2));
  let child=null,stderr="";
  try{
    console.log(JSON.stringify({event:"L2_BROKER_READONLY_CANARY_START",commit_sha:commit||null,production_worker_traffic_changed:false,dynamic_route_mutation:false,secrets_redacted:true}));
    child=spawn("npx",["--yes",`wrangler@${WRANGLER}`,"dev","--config","wrangler.jsonc","--ip","127.0.0.1","--port",String(PORT)],{cwd:dir,env:{...process.env,CI:"1",NO_COLOR:"1"},stdio:["ignore","pipe","pipe"]});
    child.stdout?.on("data",()=>{});child.stderr?.on("data",chunk=>{stderr=(stderr+String(chunk)).slice(-12000)});
    await waitReady(child);
    const {response,body}=await requestLocal("/run",{method:"POST",headers:{accept:"application/json"}},RUN_TIMEOUT_MS);
    if(!response.ok||body?.ok!==true)throw Object.assign(new Error(body?.error||`BROKER_READONLY_HTTP_${response.status}`),{details:body});
    console.log(JSON.stringify({event:"L2_BROKER_READONLY_CANARY_PASS",ok:true,commit_sha:commit||null,broker_rpc:true,routes_readable:true,route_count:body?.route_count??null,dynamic_route_mutation:false,production_worker_traffic_changed:false,secrets_redacted:true}));
  }catch(error){console.error(JSON.stringify({event:"L2_BROKER_READONLY_CANARY_FAIL",error:String(error?.message||error),details:error?.details||null,stderr_tail:String(stderr).slice(-4000),dynamic_route_mutation:false,production_worker_traffic_changed:false,secrets_redacted:true}));process.exitCode=1}
  finally{stop(child);rmSync(dir,{recursive:true,force:true})}
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main();
