#!/usr/bin/env node
import {spawn} from "node:child_process";
import {mkdirSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const PORT=8801;
const READY_TIMEOUT_MS=30000;
const REQUEST_TIMEOUT_MS=20000;
const MAX_ATTEMPTS=8;
const RETRY_DELAY_MS=10000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function stop(child){
  if(!child||child.exitCode!==null)return;
  const grouped=process.platform!=="win32"&&Number.isInteger(child.pid);
  try{if(grouped)process.kill(-child.pid,"SIGTERM");else child.kill("SIGTERM")}catch{}
  setTimeout(()=>{
    if(child.exitCode!==null)return;
    try{if(grouped)process.kill(-child.pid,"SIGKILL");else child.kill("SIGKILL")}catch{}
  },1500).unref?.();
}

async function requestLocal(path,init={},timeoutMs=5000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(`http://127.0.0.1:${PORT}${path}`,{...init,signal:controller.signal});
    const body=await response.json().catch(()=>null);
    return{response,body};
  }finally{clearTimeout(timer)}
}

async function waitReady(child){
  const deadline=Date.now()+READY_TIMEOUT_MS;
  let last=null;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`WRANGLER_DEV_EXITED:${child.exitCode}`);
    try{
      const {response,body}=await requestLocal("/ready");
      if(response.ok&&body?.ok===true)return;
    }catch(error){last=error}
    await sleep(1000);
  }
  throw last||new Error("BROKER_READONLY_DRIVER_NOT_READY");
}

async function main(){
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  const dir=resolve(".l2-broker-readonly-canary");
  rmSync(dir,{recursive:true,force:true});
  mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"driver.mjs"),`export default{async fetch(request,env){const u=new URL(request.url);if(request.method==="GET"&&u.pathname==="/ready")return Response.json({ok:true});if(request.method!=="POST"||u.pathname!=="/run")return Response.json({ok:false,error:"NOT_FOUND"},{status:404});try{const payload=await env.AI_GATEWAY_CONTROL.request({operation:"routes.list"});const ok=payload?.success!==false;const routeCount=Array.isArray(payload?.result)?payload.result.length:null;return Response.json({ok,broker_rpc:true,routes_readable:ok,route_count:routeCount,secrets_redacted:true},{status:ok?200:502})}catch(error){return Response.json({ok:false,error:String(error?.message||error),details:error?.details||null,secrets_redacted:true},{status:error?.status||502})}}};\n`);
  writeFileSync(resolve(dir,"wrangler.jsonc"),JSON.stringify({name:"l2-broker-readonly-canary",main:"driver.mjs",compatibility_date:"2026-08-20",compatibility_flags:["nodejs_compat"],services:[{binding:"AI_GATEWAY_CONTROL",service:"admin-worker",entrypoint:"AIGatewayControl",remote:true}]},null,2));

  console.log(JSON.stringify({event:"L2_BROKER_READONLY_CANARY_START",commit_sha:commit||null,max_attempts:MAX_ATTEMPTS,single_driver_lifecycle:true,production_worker_traffic_changed:false,dynamic_route_mutation:false,secrets_redacted:true}));

  let child=null;
  let last={ok:false,error:"NOT_ATTEMPTED"};
  try{
    child=spawn("npx",["--no-install","wrangler","dev","--config","wrangler.jsonc","--ip","127.0.0.1","--port",String(PORT)],{
      cwd:dir,
      env:{...process.env,CI:"1",NO_COLOR:"1"},
      detached:process.platform!=="win32",
      stdio:["ignore","ignore","ignore"]
    });
    await waitReady(child);

    for(let attemptNumber=1;attemptNumber<=MAX_ATTEMPTS;attemptNumber++){
      try{
        const {response,body}=await requestLocal("/run",{method:"POST",headers:{accept:"application/json"}},REQUEST_TIMEOUT_MS);
        if(response.ok&&body?.ok===true){
          console.log(JSON.stringify({event:"L2_BROKER_READONLY_CANARY_PASS",ok:true,commit_sha:commit||null,attempt:attemptNumber,broker_rpc:true,routes_readable:true,route_count:body?.route_count??null,dynamic_route_mutation:false,production_worker_traffic_changed:false,secrets_redacted:true}));
          return;
        }
        last={ok:false,error:String(body?.error||`BROKER_READONLY_HTTP_${response.status}`),details:body?.details||null};
      }catch(error){
        last={ok:false,error:String(error?.message||error)};
      }
      console.log(JSON.stringify({event:"L2_BROKER_READONLY_CANARY_RETRY",attempt:attemptNumber,error:String(last.error||"UNKNOWN").slice(0,180),dynamic_route_mutation:false,secrets_redacted:true}));
      if(attemptNumber<MAX_ATTEMPTS)await sleep(RETRY_DELAY_MS);
    }

    throw Object.assign(new Error(last.error||"BROKER_READONLY_CANARY_EXHAUSTED"),{details:last.details||null});
  }catch(error){
    console.error(JSON.stringify({event:"L2_BROKER_READONLY_CANARY_FAIL",error:String(error?.message||error).slice(0,240),details:error?.details||null,attempts:MAX_ATTEMPTS,dynamic_route_mutation:false,production_worker_traffic_changed:false,secrets_redacted:true}));
    process.exitCode=1;
  }finally{
    stop(child);
    await sleep(1800);
    rmSync(dir,{recursive:true,force:true});
  }
}

if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main();
