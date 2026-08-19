#!/usr/bin/env node
import {spawn} from "node:child_process";
import {mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const COMMIT_PATTERN=/^[a-f0-9]{40}$/i;
const DRIVER_PORT=8799;
const READY_TIMEOUT_MS=75000;
const RUN_TIMEOUT_MS=9*60*1000;
let phase="boot";
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function mark(next,details={}){phase=next;console.log(JSON.stringify({event:"L2_LOCAL_ROUTE_CANDIDATE_PHASE",phase,at:new Date().toISOString(),...details,secrets_redacted:true}))}
function stop(child){if(!child||child.exitCode!==null)return;try{child.kill("SIGTERM")}catch{}setTimeout(()=>{if(child.exitCode===null)try{child.kill("SIGKILL")}catch{}},1500).unref?.()}
async function requestLocal(path,init={},timeoutMs=5000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(`http://127.0.0.1:${DRIVER_PORT}${path}`,{...init,signal:c.signal});const body=await r.json().catch(()=>null);return{response:r,body}}finally{clearTimeout(t)}}
async function waitReady(child){const deadline=Date.now()+READY_TIMEOUT_MS;let last=null;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`WRANGLER_DEV_EXITED:${child.exitCode}`);try{const {response,body}=await requestLocal("/ready");if(response.ok&&body?.ok===true)return body}catch(error){last=error}await sleep(1000)}throw last||new Error("LOCAL_ROUTE_CANDIDATE_DRIVER_NOT_READY")}

async function main(){
  mark("trigger-read");
  const trigger=JSON.parse(readFileSync("l2-acceptance-request.json","utf8"));
  if(trigger?.schema!=="expert-l2-acceptance-v1"||trigger?.enabled!==true)throw new Error("L2_TRIGGER_INVALID");
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!COMMIT_PATTERN.test(commit))throw new Error("L2_COMMIT_SHA_INVALID");
  const token=String(process.env.CLOUDFLARE_AI_GATEWAY_API_TOKEN||"").trim();
  if(!token)throw new Error("L2_AI_GATEWAY_BUILD_SECRET_REQUIRED");
  const accountId=String(process.env.CLOUDFLARE_ACCOUNT_ID||"e3aec027af13c557bbcb831d29c1e7b4").trim();
  const gatewayId=String(process.env.AI_GATEWAY_ID||"test").trim();
  const routeName=String(process.env.AI_GATEWAY_ROUTE||"expert-panel-v1").trim();
  const dir=resolve(".l2-local-route-candidate");rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"expert-route-manager.js"),readFileSync(resolve("src/expert-route-manager.js"),"utf8"));
  writeFileSync(resolve(dir,".dev.vars"),`CLOUDFLARE_AI_GATEWAY_API_TOKEN=${token.replace(/\r?\n/g,"")}\n`);
  writeFileSync(resolve(dir,"driver.mjs"),`import {refreshExpertRoute} from "./expert-route-manager.js";
const CF_API="https://api.cloudflare.com/client/v4";
const timed=async(url,init={})=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),30000);try{return await fetch(url,{...init,signal:c.signal})}finally{clearTimeout(t)}};
async function deploy(env,row,version){const url=CF_API+"/accounts/"+encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)+"/ai-gateway/gateways/"+encodeURIComponent(env.AI_GATEWAY_ID)+"/routes/"+encodeURIComponent(row.route_id)+"/deployments";const r=await timed(url,{method:"POST",headers:{authorization:"Bearer "+env.CLOUDFLARE_AI_GATEWAY_API_TOKEN,accept:"application/json","content-type":"application/json"},body:JSON.stringify({version_id:version})});const b=await r.json().catch(()=>null);if(!r.ok||b?.success===false)throw new Error("ROLLBACK_REHEARSAL_DEPLOY_FAILED:"+r.status);return true}
async function rehearse(env,result){const row=(result.route_family||[]).find(x=>x.previous_version_id&&x.version_id&&x.route_id);if(!row)return{ok:false,error:"NO_PREVIOUS_ROUTE_VERSION_FOR_REHEARSAL"};let previousApplied=false;try{await deploy(env,row,row.previous_version_id);previousApplied=true;await deploy(env,row,row.version_id);previousApplied=false;return{ok:true,route_name:row.route_name,previous_version_id:row.previous_version_id,candidate_version_id:row.version_id}}finally{if(previousApplied)await deploy(env,row,row.version_id).catch(()=>{})}}
export default{async fetch(request,env){const u=new URL(request.url);if(request.method==="GET"&&u.pathname==="/ready")return Response.json({ok:true});if(request.method!=="POST"||u.pathname!=="/run")return Response.json({ok:false,error:"NOT_FOUND"},{status:404});try{const result=await refreshExpertRoute(env,{previous:null,expertBinding:env.EXPERT_CENTER});const routes=Array.isArray(result?.route_family)?result.route_family:[],lanes=Array.isArray(result?.company_lanes)?result.company_lanes:[],companies=lanes.map(x=>String(x?.company||"")).filter(Boolean);const baseOk=result?.ok===true&&result?.status==="active"&&routes.length===8&&lanes.length===8&&new Set(companies).size===8&&result?.selftest?.ok===true&&result?.selftest?.company_diverse===true;if(!baseOk)return Response.json({ok:false,error:"L2_ROUTE_ACCEPTANCE_CONTRACT_FAILED",result,secrets_redacted:true},{status:502});const rollback=await rehearse(env,result);const ok=rollback.ok===true;return Response.json({ok,result,rollback_rehearsal:rollback,secrets_redacted:true},{status:ok?200:502})}catch(error){return Response.json({ok:false,error:String(error?.message||error),details:error?.details||null,secrets_redacted:true},{status:error?.status||502})}}};\n`);
  writeFileSync(resolve(dir,"wrangler.jsonc"),JSON.stringify({name:"l2-local-route-candidate-driver",main:"driver.mjs",compatibility_date:"2026-08-20",compatibility_flags:["nodejs_compat"],vars:{CLOUDFLARE_ACCOUNT_ID:accountId,AI_GATEWAY_ID:gatewayId,AI_GATEWAY_ROUTE:routeName,AI_GATEWAY_ROUTE_FAMILY:routeName.replace(/-v\d+$/i,"")||"expert-panel"},services:[{binding:"EXPERT_CENTER",service:"expert-worker",remote:true}]},null,2));
  let child=null;let stderr="";
  try{
    mark("local-candidate-start",{local_worker_execution:true,remote_expert_binding:true,worker_deployment_mutation:false,dynamic_route_mutation:true});
    child=spawn("npx",["--yes",`wrangler@${WRANGLER}`,"dev","--config","wrangler.jsonc","--ip","127.0.0.1","--port",String(DRIVER_PORT)],{cwd:dir,env:{...process.env,CI:"1",NO_COLOR:"1"},stdio:["ignore","pipe","pipe"]});
    child.stdout?.on("data",()=>{});child.stderr?.on("data",chunk=>{stderr=(stderr+String(chunk)).slice(-12000)});
    await waitReady(child);mark("local-candidate-ready");
    const {response,body}=await requestLocal("/run",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({request_id:trigger.request_id})},RUN_TIMEOUT_MS);
    if(!response.ok||body?.ok!==true)throw Object.assign(new Error(body?.error||`L2_ROUTE_ACCEPTANCE_HTTP_${response.status}`),{details:body});
    const result=body.result||{},routes=result.route_family||[],lanes=result.company_lanes||[];
    mark("route-family-accepted",{route_family_count:routes.length,company_lane_count:lanes.length,expert_selftest_ok:result?.selftest?.ok===true,company_diverse:result?.selftest?.company_diverse===true,rollback_rehearsal_ok:body?.rollback_rehearsal?.ok===true});
    console.log(JSON.stringify({event:"L2_LOCAL_ROUTE_CANDIDATE_PASS",ok:true,commit_sha:commit,route_family_count:8,company_lane_count:8,expert_selftest_ok:true,company_diverse:true,rollback_rehearsal_ok:true,rollback_route:body.rollback_rehearsal?.route_name||null,plan_digest:result.plan_digest||null,free_lane_count:result.free_lane_count??null,worker_deployment_mutated:false,production_worker_traffic_changed:false,dynamic_routes_deployed:true,build_secret_logged:false,secrets_redacted:true}));
  }catch(error){throw Object.assign(error,{stderr_tail:stderr,details:error?.details||null})}
  finally{stop(child);rmSync(dir,{recursive:true,force:true})}
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main().catch(error=>{console.error(JSON.stringify({event:"L2_LOCAL_ROUTE_CANDIDATE_FAIL",phase,error:String(error?.message||error),details:error?.details||null,stderr_tail:String(error?.stderr_tail||"").slice(-4000),secrets_redacted:true}));process.exitCode=1});
