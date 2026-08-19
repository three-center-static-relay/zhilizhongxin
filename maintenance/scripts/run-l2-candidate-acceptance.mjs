#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

function childEnv(stripCiOverride=false){
  const env={...process.env,CI:"1"};
  if(stripCiOverride)delete env.WRANGLER_CI_OVERRIDE_NAME;
  return env;
}
function run(command,args,cwd,{stdio="pipe",stripCiOverride=false}={}){
  const r=spawnSync(command,args,{cwd,encoding:"utf8",env:childEnv(stripCiOverride),stdio,maxBuffer:4*1024*1024,timeout:19*60*1000,killSignal:"SIGKILL"});
  if(r.error||r.status!==0)throw Object.assign(new Error(`${command.toUpperCase()}_FAILED:${args.join(" ")}`),{stdout:r.stdout,stderr:r.stderr});
  return r;
}
function main(){
  console.log(JSON.stringify({event:"L2_STABLE_ADMIN_DEPLOYMENT_MODE",admin_candidate_upload:false,admin_candidate_staging:false,maintenance_candidate_staging:true,secrets_redacted:true}));
  run(process.execPath,[resolve(process.cwd(),"scripts/run-l2-candidate-acceptance-core.mjs")],process.cwd(),{stdio:"inherit",stripCiOverride:true});
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href){
  try{main()}catch(error){
    console.error(JSON.stringify({event:"L2_WRAPPER_FAIL",error:String(error?.message||error),secrets_redacted:true}));
    process.exitCode=1;
  }
}
