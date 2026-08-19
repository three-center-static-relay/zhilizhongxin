#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const COMMIT_PATTERN=/^[a-f0-9]{40}$/i;
const TAG_PATTERN=/^[a-f0-9]{12}$/i;
const WRANGLER_TIMEOUT_MS=120000;
let phase="boot";

function mark(next,details={}){
  phase=next;
  console.log(JSON.stringify({event:"L2_STATELESS_SCAFFOLD_PROBE_PHASE",phase,at:new Date().toISOString(),...details,secrets_redacted:true}));
}
function run(args,{cwd=process.cwd()}={}){
  const result=spawnSync("npx",["--yes",`wrangler@${WRANGLER}`,...args],{
    cwd,encoding:"utf8",env:{...process.env,CI:"1"},maxBuffer:8*1024*1024,timeout:WRANGLER_TIMEOUT_MS,killSignal:"SIGTERM"
  });
  if(result.error?.code==="ETIMEDOUT")throw Object.assign(new Error(`WRANGLER_TIMEOUT:${args.join(" ")}`),{stdout:result.stdout,stderr:result.stderr});
  if(result.error||result.status!==0)throw Object.assign(new Error(`WRANGLER_FAILED:${args.join(" ")}`),{stdout:result.stdout,stderr:result.stderr});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  return result;
}

async function main(){
  mark("trigger-read");
  const request=JSON.parse(readFileSync("l2-acceptance-request.json","utf8"));
  if(request?.schema!=="expert-l2-acceptance-v1"||request?.enabled!==true)throw new Error("L2_TRIGGER_INVALID");
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!COMMIT_PATTERN.test(commit))throw new Error("L2_COMMIT_SHA_INVALID");
  const tag=commit.slice(0,12);
  if(!TAG_PATTERN.test(tag))throw new Error("L2_TAG_INVALID");

  const workerName=`l2-scaffold-probe-${tag}`;
  const dir=resolve(".l2-stateless-scaffold");
  const configPath=resolve(dir,"wrangler.jsonc");
  rmSync(dir,{recursive:true,force:true});
  mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,"worker.mjs"),`export default{fetch(){return new Response("not found",{status:404})}};\n`);
  writeFileSync(configPath,JSON.stringify({
    name:workerName,
    main:"worker.mjs",
    compatibility_date:"2026-08-18",
    compatibility_flags:["nodejs_compat"],
    workers_dev:false,
    preview_urls:false
  },null,2));

  let created=false;
  let cleanup={attempted:false,ok:null,error:null};
  try{
    mark("scaffold-deploy-begin",{worker:workerName,workers_dev:false,preview_urls:false,no_routes:true,stateless:true});
    run(["deploy","--config",configPath],{cwd:dir});
    created=true;
    mark("scaffold-deploy-complete",{worker:workerName,workers_dev:false,preview_urls:false,no_routes:true});
  }finally{
    if(created){
      cleanup.attempted=true;
      try{
        mark("cleanup-delete-begin",{worker:workerName,best_effort:true});
        run(["delete","--name",workerName],{cwd:dir});
        cleanup.ok=true;
        mark("cleanup-delete-complete",{worker:workerName,best_effort:true});
      }catch(error){
        cleanup.ok=false;
        cleanup.error=String(error?.message||error);
        mark("cleanup-delete-nonblocking-fail",{worker:workerName,best_effort:true});
      }
    }
    rmSync(dir,{recursive:true,force:true});
  }

  console.log(JSON.stringify({
    event:"L2_STATELESS_SCAFFOLD_DEPLOY_PROBE_PASS",
    ok:true,
    commit_sha:commit,
    worker_name:workerName,
    scaffold_deployed:true,
    workers_dev:false,
    preview_urls:false,
    routes_configured:false,
    durable_object_implemented:false,
    secret_used:false,
    version_upload_attempted:false,
    preview_http_attempted:false,
    ai_gateway_called:false,
    dynamic_routes_mutated:false,
    cleanup,
    cleanup_required_for_probe_pass:false,
    existing_production_workers_mutated:false,
    existing_production_traffic_changed:false,
    secrets_redacted:true
  }));
}

if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href)main().catch(error=>{
  console.error(JSON.stringify({event:"L2_STATELESS_SCAFFOLD_DEPLOY_PROBE_FAIL",phase,error:String(error?.message||error),secrets_redacted:true}));
  process.exitCode=1;
});
