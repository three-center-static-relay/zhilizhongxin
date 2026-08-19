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
const PHASES=new Set(["predeploy-control-plane","postdeploy-runtime"]);
let phase="boot";
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function mark(next,details={}){phase=next;console.log(JSON.stringify({event:"L2_LOCAL_ROUTE_CANDIDATE_PHASE",phase,at:new Date().toISOString(),...details,secrets_redacted:true}))}
function stop(child){if(!child||child.exitCode!==null)return;try{child.kill("SIGTERM")}catch{}setTimeout(()=>{if(child.exitCode===null)try{child.kill("SIGKILL")}catch{}},1500).unref?.()}
async function requestLocal(path,init={},timeoutMs=5000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(`http://127.0.0.1:${DRIVER_PORT}${path}`,{...init,signal:c.signal});const body=await r.json().catch(()=>null);return{response:r,body}}finally{clearTimeout(t)}}
async function waitReady(child){const deadline=Date.now()+READY_TIMEOUT_MS;let last=null;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`WRANGLER_DEV_EXITED:${child.exitCode}`);try{const {response,body}=await requestLocal("/ready");if(response.ok&&body?.ok===true)return body}catch(error){last=error}await sleep(1000)}throw last||new Error("LOCAL_ROUTE_CANDIDATE_DRIVER_NOT_READY")}

function brokerizeManager(source){
  const routeStart=source.indexOf("function routeConfig(env) {");
  const routeEnd=source.indexOf("\n\nfunction companyOf",routeStart);
  const cfStart=source.indexOf("function cfUrl(config, path) {");
  const cfEnd=source.indexOf("\nfunction resultData",cfStart);
  if(routeStart<0||routeEnd<0||cfStart<0||cfEnd<0)throw new Error("L2_BROKER_MANAGER_PATCH_ANCHOR_MISSING");
  const routeReplacement=`function routeConfig(env) {
  const control=env.AI_GATEWAY_CONTROL;
  const gatewayId=String(env.AI_GATEWAY_ID||"test").trim();
  const routeName=String(env.AI_GATEWAY_ROUTE||"expert-panel-v1").trim();
  if(!control?.request||!gatewayId||!routeName)throw fail("EXPERT_ROUTE_CONTROL_PLANE_NOT_CONFIGURED",503,{broker_configured:Boolean(control?.request),gateway_id_configured:Boolean(gatewayId),route_name_configured:Boolean(routeName)});
  const routeFamily=String(env.AI_GATEWAY_ROUTE_FAMILY||routeName.replace(/-v\\d+$/i,"")||"expert-panel").trim();
  return {gatewayId,routeName,routeFamily,control};
}`;
  const cfReplacement=`function brokerInput(path,{method="GET",body}={}){
  const u=new URL("https://control.internal"+path);
  if(method==="GET"&&u.pathname==="/logs")return{operation:"logs.list",page:Number(u.searchParams.get("page")||1),per_page:Number(u.searchParams.get("per_page")||50)};
  if(method==="GET"&&u.pathname==="/routes")return{operation:"routes.list"};
  if(method==="POST"&&u.pathname==="/routes")return{operation:"routes.create",name:body?.name,elements:body?.elements};
  let m=u.pathname.match(/^\\/routes\\/([^/]+)\\/versions$/);
  if(m&&method==="GET")return{operation:"versions.list",route_id:decodeURIComponent(m[1])};
  if(m&&method==="POST")return{operation:"versions.create",route_id:decodeURIComponent(m[1]),elements:body?.elements};
  m=u.pathname.match(/^\\/routes\\/([^/]+)\\/versions\\/([^/]+)$/);
  if(m&&method==="GET")return{operation:"versions.get",route_id:decodeURIComponent(m[1]),version_id:decodeURIComponent(m[2])};
  m=u.pathname.match(/^\\/routes\\/([^/]+)\\/deployments$/);
  if(m&&method==="POST")return{operation:"deployments.create",route_id:decodeURIComponent(m[1]),version_id:body?.version_id};
  throw fail("AI_GATEWAY_BROKER_OPERATION_UNMAPPED",500,{method,path:u.pathname});
}
async function cf(config,path,{method="GET",body,optional=false}={}){
  try{return await config.control.request(brokerInput(path,{method,body}))}
  catch(error){if(optional)return null;throw error}
}`;
  const withRoute=source.slice(0,routeStart)+routeReplacement+source.slice(routeEnd);
  const adjustedCfStart=withRoute.indexOf("function cfUrl(config, path) {");
  const adjustedCfEnd=withRoute.indexOf("\nfunction resultData",adjustedCfStart);
  if(adjustedCfStart<0||adjustedCfEnd<0)throw new Error("L2_BROKER_CF_PATCH_ANCHOR_MISSING");
  const patched=withRoute.slice(0,adjustedCfStart)+cfReplacement+withRoute.slice(adjustedCfEnd);
  const forbiddenTokenName=["CLOUDFLARE","AI_GATEWAY","API_TOKEN"].join("_");
  if(patched.includes(forbiddenTokenName))throw new Error("L2_BROKER_PATCH_LEFT_DIRECT_TOKEN");
  return patched;
}

async function main(){
  mark("trigger-read");
  const trigger=JSON.parse(readFileSync("l2-acceptance-request.json","utf8"));
  if(trigger?.schema!=="expert-l2-acceptance-v1"||trigger?.enabled!==true)throw new Error("L2_TRIGGER_INVALID");
  const acceptancePhase=String(trigger?.phase||"").trim();
  if(!PHASES.has(acceptancePhase))throw new Error("L2_ACCEPTANCE_PHASE_INVALID");
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!COMMIT_PATTERN.test(commit))throw new Error("L2_COMMIT_SHA_INVALID");
  const gatewayId=String(process.env.AI_GATEWAY_ID||"test").trim();
  const routeName=String(process.env.AI_GATEWAY_ROUTE||"expert-panel-v1").trim();
  const dir=resolve(".l2-local-route-candidate");rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  const managerSource=brokerizeManager(readFileSync(resolve("src/expert-route-manager.js"),"utf8"));
  writeFileSync(resolve(dir,"expert-route-manager.js"),managerSource);
  writeFileSync(resolve(dir,"driver.mjs"),`import {refreshExpertRoute} from "./expert-route-manager.js";
async function deploy(env,row,version){const b=await env.AI_GATEWAY_CONTROL.request({operation:"deployments.create",route_id:row.route_id,version_id:version});if(b?.success===false)throw new Error("ROLLBACK_REHEARSAL_DEPLOY_FAILED");return true}
async function rehearse(env,result){const row=(result.route_family||[]).find(x=>x.previous_version_id&&x.version_id&&x.route_id);if(!row)return{ok:false,error:"NO_PREVIOUS_ROUTE_VERSION_FOR_REHEARSAL"};let previousApplied=false;try{await deploy(env,row,row.previous_version_id);previousApplied=true;await deploy(env,row,row.version_id);previousApplied=false;return{ok:true,route_name:row.route_name,previous_version_id:row.previous_version_id,candidate_version_id:row.version_id}}finally{if(previousApplied)await deploy(env,row,row.version_id).catch(()=>{})}}
function compatibilityExpertBinding(env,acceptancePhase){return{async fetch(request){const u=new URL(request.url);if(u.pathname==="/v1/admin/context")return Response.json({ok:true,active_task:null,compatibility_adapter:true});if(u.pathname==="/v1/selftest"){if(acceptancePhase==="predeploy-control-plane")return Response.json({ok:true,company_diverse:true,models:[],runtime_selftest_skipped:true,compatibility_adapter:true});const taskId="l2-postdeploy-"+crypto.randomUUID();const response=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/run",{method:"POST",headers:{accept:"application/json","content-type":"application/json","x-three-center-selftest":"1"},body:JSON.stringify({task_id:taskId,prompt:"L2 production route self-test. Return a concise deterministic response.",model_count:2,timeout_seconds:120})}));const body=await response.json().catch(()=>({}));return Response.json({ok:response.ok&&body?.ok===true&&body?.company_diverse===true,company_diverse:body?.company_diverse===true,models:Array.isArray(body?.models)?body.models:[],upstream_http_status:response.status,upstream_error:body?.error||null,compatibility_adapter:true},{status:response.ok?200:response.status||502})}return env.EXPERT_CENTER.fetch(request)}}}
export default{async fetch(request,env){const u=new URL(request.url);if(request.method==="GET"&&u.pathname==="/ready")return Response.json({ok:true});if(request.method!=="POST"||u.pathname!=="/run")return Response.json({ok:false,error:"NOT_FOUND"},{status:404});try{const acceptancePhase=${JSON.stringify(acceptancePhase)};const expertBinding=compatibilityExpertBinding(env,acceptancePhase);const result=await refreshExpertRoute(env,{previous:null,expertBinding});const routes=Array.isArray(result?.route_family)?result.route_family:[],lanes=Array.isArray(result?.company_lanes)?result.company_lanes:[],companies=lanes.map(x=>String(x?.company||"")).filter(Boolean);const routeOk=result?.ok===true&&result?.status==="active"&&routes.length===8&&lanes.length===8&&new Set(companies).size===8;const runtimeOk=acceptancePhase==="predeploy-control-plane"||result?.selftest?.ok===true&&result?.selftest?.company_diverse===true;if(!(routeOk&&runtimeOk))return Response.json({ok:false,error:"L2_ROUTE_ACCEPTANCE_CONTRACT_FAILED",acceptance_phase:acceptancePhase,result,secrets_redacted:true},{status:502});const rollback=await rehearse(env,result);const ok=rollback.ok===true;return Response.json({ok,result,acceptance_phase:acceptancePhase,runtime_selftest_required:acceptancePhase==="postdeploy-runtime",runtime_selftest_ok:acceptancePhase==="postdeploy-runtime"?result?.selftest?.ok===true:null,rollback_rehearsal:rollback,secrets_redacted:true},{status:ok?200:502})}catch(error){return Response.json({ok:false,error:String(error?.message||error),details:error?.details||null,secrets_redacted:true},{status:error?.status||502})}}};
`);
  writeFileSync(resolve(dir,"wrangler.jsonc"),JSON.stringify({name:"l2-local-route-candidate-driver",main:"driver.mjs",compatibility_date:"2026-08-20",compatibility_flags:["nodejs_compat"],vars:{AI_GATEWAY_ID:gatewayId,AI_GATEWAY_ROUTE:routeName,AI_GATEWAY_ROUTE_FAMILY:routeName.replace(/-v\d+$/i,"")||"expert-panel"},services:[{binding:"EXPERT_CENTER",service:"expert-worker",remote:true},{binding:"AI_GATEWAY_CONTROL",service:"admin-worker",entrypoint:"AIGatewayControl",remote:true}]},null,2));
  let child=null,stderr="";
  try{
    mark("local-candidate-start",{acceptance_phase:acceptancePhase,local_worker_execution:true,remote_expert_binding:true,remote_ai_gateway_control:true,worker_deployment_mutation:false,dynamic_route_mutation:true});
    child=spawn("npx",["--yes",`wrangler@${WRANGLER}`,"dev","--config","wrangler.jsonc","--ip","127.0.0.1","--port",String(DRIVER_PORT)],{cwd:dir,env:{...process.env,CI:"1",NO_COLOR:"1"},stdio:["ignore","pipe","pipe"]});
    child.stdout?.on("data",()=>{});child.stderr?.on("data",chunk=>{stderr=(stderr+String(chunk)).slice(-12000)});
    await waitReady(child);mark("local-candidate-ready",{acceptance_phase:acceptancePhase});
    const {response,body}=await requestLocal("/run",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({request_id:trigger.request_id})},RUN_TIMEOUT_MS);
    if(!response.ok||body?.ok!==true)throw Object.assign(new Error(body?.error||`L2_ROUTE_ACCEPTANCE_HTTP_${response.status}`),{details:body});
    const result=body.result||{},routes=result.route_family||[],lanes=result.company_lanes||[];
    mark("route-family-accepted",{acceptance_phase:acceptancePhase,route_family_count:routes.length,company_lane_count:lanes.length,runtime_selftest_required:body?.runtime_selftest_required===true,runtime_selftest_ok:body?.runtime_selftest_ok===true,company_diverse:acceptancePhase==="postdeploy-runtime"?result?.selftest?.company_diverse===true:null,rollback_rehearsal_ok:body?.rollback_rehearsal?.ok===true});
    console.log(JSON.stringify({event:"L2_LOCAL_ROUTE_CANDIDATE_PASS",ok:true,commit_sha:commit,acceptance_phase:acceptancePhase,route_family_count:8,company_lane_count:8,runtime_selftest_required:acceptancePhase==="postdeploy-runtime",runtime_selftest_ok:acceptancePhase==="postdeploy-runtime"?true:null,company_diverse:acceptancePhase==="postdeploy-runtime"?true:null,rollback_rehearsal_ok:true,rollback_route:body.rollback_rehearsal?.route_name||null,plan_digest:result.plan_digest||null,free_lane_count:result.free_lane_count??null,worker_deployment_mutated:false,production_worker_traffic_changed:false,dynamic_routes_deployed:true,control_plane_via_admin_broker:true,secrets_redacted:true}));
  }catch(error){throw Object.assign(error,{stderr_tail:stderr,details:error?.details||null})}
  finally{stop(child);rmSync(dir,{recursive:true,force:true})}
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main().catch(error=>{console.error(JSON.stringify({event:"L2_LOCAL_ROUTE_CANDIDATE_FAIL",phase,error:String(error?.message||error),details:error?.details||null,stderr_tail:String(error?.stderr_tail||"").slice(-4000),secrets_redacted:true}));process.exitCode=1});
