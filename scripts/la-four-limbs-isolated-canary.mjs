#!/usr/bin/env node
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";

const ROOT=resolve(process.cwd(),"..");
const SHA=String(process.env.WORKERS_CI_COMMIT_SHA||"").toLowerCase();
const SUFFIX=/^[a-f0-9]{40,64}$/.test(SHA)?SHA.slice(0,8):randomBytes(4).toString("hex");
const EXPERT_NAME=`expert-la-brain-canary-${SUFFIX}`;
const ADMIN_NAME=`admin-la-four-limbs-${SUFFIX}`;
const EXPERT_BRANCH="feature/la-free-cloudflare-openrouter-fallback-20260822";
const WORKER_VERSION="4.123.0";
const work=mkdtempSync(join(tmpdir(),"la-four-limbs-"));
const expertDir=join(work,"expert");
const adminDir=resolve(ROOT,"admin");
const token=randomBytes(32).toString("hex");
let adminDeployed=false,expertDeployed=false;

function fail(code,details={}){const e=new Error(code);e.details=details;throw e}
function ok(value,code,details={}){if(!value)fail(code,details)}
function run(cmd,args,{cwd=ROOT,allowFail=false}={}){const r=spawnSync(cmd,args,{cwd,encoding:"utf8",env:process.env,maxBuffer:8*1024*1024});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error)throw r.error;if(!allowFail&&r.status!==0)fail(`${cmd.toUpperCase()}_FAILED`,{status:r.status});return r}
function wrangler(args,cwd){return run("npx",["--yes",`wrangler@${WORKER_VERSION}`,...args],{cwd})}
function workerBase(name){const spec=JSON.parse(readFileSync(resolve(adminDir,"openapi.json"),"utf8")),u=new URL(String(spec?.servers?.[0]?.url||""));ok(u.protocol==="https:"&&u.hostname.startsWith("admin-worker.")&&u.hostname.endsWith(".workers.dev"),"ADMIN_WORKERS_DEV_URL_REQUIRED");u.hostname=u.hostname.replace(/^admin-worker\./,`${name}.`);return`${u.protocol}//${u.host}`}
function digest64(x){return /^[a-f0-9]{64}$/i.test(String(x||""))}

function writeExpertCanary(){
  const entry=`import {runLangGraphBrain} from "./src/langgraph-brain.js";\nconst RUNTIME="@langchain/langgraph@1.4.10";\nexport default{async fetch(req,env){const u=new URL(req.url);if(req.method==="POST"&&u.pathname==="/v1/langgraph/run"){const clone=req.clone(),body=await clone.json().catch(()=>null);if(body?.mode==="brain-advisory"){const result=await runLangGraphBrain(body,env);return Response.json({...result,runtime:RUNTIME,mode:"brain-advisory",brain_mode:String(result?.mode||""),model_invoked:Boolean(result?.model),tools_used:false,web_used:false,production_mutation:false},{status:200,headers:{"cache-control":"no-store"}})}}if(!env.PRODUCTION_EXPERT?.fetch)return Response.json({ok:false,error:"PRODUCTION_EXPERT_UNBOUND"},{status:502});return env.PRODUCTION_EXPERT.fetch(req)}};\n`;
  writeFileSync(resolve(expertDir,"canary-proxy.js"),entry);
  const cfg={name:EXPERT_NAME,main:"canary-proxy.js",compatibility_date:"2026-08-14",workers_dev:false,ai:{binding:"AI"},services:[{binding:"PRODUCTION_EXPERT",service:"expert-worker"}]};
  writeFileSync(resolve(expertDir,"wrangler.canary.json"),JSON.stringify(cfg,null,2));
}

function writeAdminCanary(){
  const entry=`import {handleLangGraphControl} from "./src/langgraph-control.js";\nconst TOKEN=${JSON.stringify(token)};\nfunction same(a,b){a=String(a||"");b=String(b||"");if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}\nexport default{async fetch(req,env){const u=new URL(req.url);if(req.method!=="POST"||u.pathname!=="/v1/admin/langgraph/canary")return Response.json({ok:false,error:"NOT_FOUND"},{status:404});if(!same(req.headers.get("x-la-canary-token"),TOKEN))return Response.json({ok:false,error:"UNAUTHORIZED"},{status:401});const internal=new Request("https://admin.internal/v1/admin/langgraph/canary",{method:"POST",headers:{accept:"application/json"}});const response=await handleLangGraphControl(internal,env);return response||Response.json({ok:false,error:"LANGGRAPH_CONTROL_UNAVAILABLE"},{status:500})}};\n`;
  const entryPath=resolve(adminDir,`.la-four-limbs-${SUFFIX}.js`),cfgPath=resolve(adminDir,`.wrangler-la-four-limbs-${SUFFIX}.json`);
  writeFileSync(entryPath,entry);
  const cfg={name:ADMIN_NAME,main:`.la-four-limbs-${SUFFIX}.js`,compatibility_date:"2026-08-14",workers_dev:true,services:[{binding:"GOVERNANCE_CENTER",service:"governance-worker"},{binding:"INTELLIGENCE_CENTER",service:"intelligence-worker"},{binding:"COMPUTE_CENTER",service:"compute-worker"},{binding:"EXPERT_CENTER",service:EXPERT_NAME}]};
  writeFileSync(cfgPath,JSON.stringify(cfg,null,2));
  return{entryPath,cfgPath};
}

async function runCanary(){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),420000);try{const r=await fetch(`${workerBase(ADMIN_NAME)}/v1/admin/langgraph/canary`,{method:"POST",headers:{accept:"application/json","x-la-canary-token":token,"cache-control":"no-store"},signal:c.signal}),b=await r.json().catch(()=>null);ok(r.status===200&&b?.ok===true,"LA_FOUR_LIMBS_HTTP_OR_OK_FAILED",{status:r.status,error:b?.error,status_name:b?.status});ok(b?.selftest==="langgraph-four-center-execution-v2","LA_FOUR_LIMBS_SELFTEST_REQUIRED");ok(b?.brain_source==="cloudflare-workers-ai-free-first"&&b?.brain_provider==="workers-ai"&&b?.brain_model_invoked===true,"LA_REAL_MODEL_BRAIN_REQUIRED",{source:b?.brain_source,provider:b?.brain_provider,model:b?.brain_model,degraded:b?.brain_degraded,trigger:b?.brain_fallback_trigger});ok(b?.brain_model==="@cf/nvidia/nemotron-3-120b-a12b"&&b?.brain_mode==="deep","LA_DEEP_FREE_BRAIN_REQUIRED",{model:b?.brain_model,mode:b?.brain_mode});ok(b?.brain_advisory_applied===true&&b?.brain_tools_used===false&&b?.brain_web_used===false&&b?.brain_production_mutation===false,"LA_BRAIN_BOUNDARY_REQUIRED");ok(b?.langgraph_validated===true&&b?.langgraph_model_invoked===false&&b?.langgraph_tools_used===false&&b?.langgraph_web_used===false,"LA_LANGGRAPH_VALIDATION_REQUIRED");const planned=new Set(Array.isArray(b?.planned_centers)?b.planned_centers.map(String):[]);for(const center of["governance","intelligence","compute","expert"])ok(planned.has(center),"LA_CENTER_NOT_PLANNED",{center,planned:[...planned]});ok(b?.all_centers_planned===true&&b?.all_centers_executed===true&&b?.brain_can_command===true,"LA_FOUR_LIMBS_COMMAND_REQUIRED");const receipts=Array.isArray(b?.center_execution_receipts)?b.center_execution_receipts:[];ok(receipts.length===4,"LA_FOUR_RECEIPTS_REQUIRED",{count:receipts.length});const by=new Map(receipts.map(x=>[String(x?.center||""),x]));for(const center of["governance","intelligence","compute","expert"]){const x=by.get(center);ok(x?.ok===true,"LA_LIMB_EXECUTION_FAILED",{center,http_status:x?.http_status,error:x?.error})}ok(digest64(by.get("governance")?.plan_digest),"LA_GOVERNANCE_PLAN_DIGEST_REQUIRED");ok(digest64(by.get("intelligence")?.receipt_digest),"LA_INTELLIGENCE_RECEIPT_REQUIRED");ok(Boolean(by.get("compute")?.task_id),"LA_COMPUTE_TASK_RECEIPT_REQUIRED",{status:by.get("compute")?.status,http_status:by.get("compute")?.http_status});ok(digest64(by.get("expert")?.output_digest)&&by.get("expert")?.company_diverse===true&&by.get("expert")?.judge_nonempty===true,"LA_EXPERT_RECEIPT_REQUIRED",{http_status:by.get("expert")?.http_status,error:by.get("expert")?.error});ok(b?.production_mutation===false&&b?.secrets_redacted===true,"LA_FINAL_SAFETY_REQUIRED");console.log(JSON.stringify({ok:true,code:"LA_REAL_BRAIN_FOUR_LIMBS_PASS",brain:{provider:b.brain_provider,model:b.brain_model,mode:b.brain_mode,source:b.brain_source},centers:[...by.entries()].map(([center,x])=>({center,ok:x.ok,http_status:x.http_status,operation:x.operation||null,task_id:x.task_id||null,result_digest:x.receipt_digest||x.output_digest||x.plan_digest||null})),all_centers_planned:true,all_centers_executed:true,brain_can_command:true,production_mutation:false,secrets_redacted:true}));return b}finally{clearTimeout(timer)}}

async function cleanup(){if(adminDeployed)wrangler(["delete","--name",ADMIN_NAME,"--force"],adminDir);if(expertDeployed)wrangler(["delete","--name",EXPERT_NAME,"--force"],expertDir);rmSync(work,{recursive:true,force:true});for(const p of[resolve(adminDir,`.la-four-limbs-${SUFFIX}.js`),resolve(adminDir,`.wrangler-la-four-limbs-${SUFFIX}.json`)])rmSync(p,{force:true})}

async function main(){try{run("git",["clone","--depth","1","--branch",EXPERT_BRANCH,"https://github.com/three-center-static-relay/zhuanjiatuan.git",expertDir],{cwd:work});writeExpertCanary();wrangler(["deploy","--config","wrangler.canary.json"],expertDir);expertDeployed=true;const{cfgPath}=writeAdminCanary();wrangler(["deploy","--config",cfgPath],adminDir);adminDeployed=true;await runCanary()}finally{try{await cleanup()}catch(e){console.error(JSON.stringify({ok:false,code:"LA_CANARY_CLEANUP_FAILED",error:String(e?.message||e),secrets_redacted:true}))}}}
main().catch(e=>{console.error(JSON.stringify({ok:false,code:String(e?.message||e),details:e?.details||null,secrets_redacted:true}));process.exitCode=1});
