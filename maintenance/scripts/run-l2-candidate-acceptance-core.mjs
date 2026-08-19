#!/usr/bin/env node
import {spawn} from "node:child_process";
import {mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const COMMIT_PATTERN=/^[a-f0-9]{40}$/i;
const DRIVER_PORT=8799;
const READY_TIMEOUT_MS=75000;
let phase="boot";
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function mark(next,details={}){
  phase=next;
  console.log(JSON.stringify({event:"L2_LOCAL_REMOTE_BINDING_PHASE",phase,at:new Date().toISOString(),...details,secrets_redacted:true}));
}
function stop(child){
  if(!child||child.exitCode!==null)return;
  try{child.kill("SIGTERM")}catch{}
  setTimeout(()=>{if(child.exitCode===null)try{child.kill("SIGKILL")}catch{}},1500).unref?.();
}
async function fetchLocal(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
  try{
    const response=await fetch(`http://127.0.0.1:${DRIVER_PORT}/health`,{headers:{accept:"application/json"},signal:controller.signal});
    const body=await response.json().catch(()=>null);
    if(!response.ok||body?.ok!==true||body?.upstream_service!=="maintenance-worker"||body?.upstream_status!==200)throw new Error(`LOCAL_DRIVER_RESPONSE_MISMATCH:${response.status}`);
    return body;
  }finally{clearTimeout(timer)}
}
async function waitReady(child){
  const deadline=Date.now()+READY_TIMEOUT_MS;let last=null;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`WRANGLER_DEV_EXITED:${child.exitCode}`);
    try{return await fetchLocal()}catch(error){last=error}
    await sleep(1000);
  }
  throw last||new Error("LOCAL_REMOTE_BINDING_DRIVER_NOT_READY");
}

async function main(){
  mark("trigger-read");
  const request=JSON.parse(readFileSync("l2-acceptance-request.json","utf8"));
  if(request?.schema!=="expert-l2-acceptance-v1"||request?.enabled!==true)throw new Error("L2_TRIGGER_INVALID");
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!COMMIT_PATTERN.test(commit))throw new Error("L2_COMMIT_SHA_INVALID");

  const dir=resolve(".l2-local-remote-binding");
  const configPath=resolve(dir,"wrangler.jsonc");
  rmSync(dir,{recursive:true,force:true});
  mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"driver.mjs"),`export default{async fetch(request,env){const u=new URL(request.url);if(request.method!=="GET"||u.pathname!=="/health")return Response.json({ok:false,error:"NOT_FOUND"},{status:404});const upstream=await env.MAINTENANCE.fetch(new Request("https://maintenance.internal/health",{method:"GET",headers:{accept:"application/json"}}));const body=await upstream.json().catch(()=>null);const ok=upstream.ok&&body?.ok===true&&body?.service==="maintenance-worker";return Response.json({ok,upstream_status:upstream.status,upstream_service:body?.service||null,upstream_ready:body?.status||null,upstream_api_version:body?.api_version||null},{status:ok?200:502})}};\n`);
  writeFileSync(configPath,JSON.stringify({
    name:"l2-local-remote-binding-driver",
    main:"driver.mjs",
    compatibility_date:"2026-08-18",
    compatibility_flags:["nodejs_compat"],
    services:[{binding:"MAINTENANCE",service:"maintenance-worker",remote:true}]
  },null,2));

  let child=null;
  try{
    mark("local-driver-start",{execution:"local",remote_service_binding:true,target:"maintenance-worker",production_mutation:false});
    child=spawn("npx",["--yes",`wrangler@${WRANGLER}`,"dev","--config",configPath,"--ip","127.0.0.1","--port",String(DRIVER_PORT)],{
      cwd:dir,env:{...process.env,CI:"1",NO_COLOR:"1"},stdio:["ignore","pipe","pipe"]
    });
    let stdout="",stderr="";
    child.stdout?.on("data",chunk=>{stdout=(stdout+String(chunk)).slice(-16000)});
    child.stderr?.on("data",chunk=>{stderr=(stderr+String(chunk)).slice(-16000)});
    child.on("error",error=>{stderr=(stderr+String(error?.message||error)).slice(-16000)});
    const body=await waitReady(child);
    mark("remote-maintenance-health-verified",{target:"maintenance-worker",http_status:body.upstream_status,service:body.upstream_service});
    console.log(JSON.stringify({
      event:"L2_LOCAL_REMOTE_SERVICE_BINDING_PROBE_PASS",
      ok:true,
      commit_sha:commit,
      local_worker_execution:true,
      remote_service_binding:true,
      target_worker:"maintenance-worker",
      upstream_http_status:body.upstream_status,
      upstream_service:body.upstream_service,
      upstream_ready:body.upstream_ready,
      upstream_api_version:body.upstream_api_version,
      new_worker_created:false,
      remote_dev_used:false,
      versions_uploaded:false,
      deployment_mutated:false,
      production_traffic_changed:false,
      secret_used:false,
      ai_gateway_called:false,
      dynamic_routes_mutated:false,
      secrets_redacted:true
    }));
  }finally{
    stop(child);
    rmSync(dir,{recursive:true,force:true});
  }
}

if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main().catch(error=>{
  console.error(JSON.stringify({event:"L2_LOCAL_REMOTE_SERVICE_BINDING_PROBE_FAIL",phase,error:String(error?.message||error),secrets_redacted:true}));
  process.exitCode=1;
});
