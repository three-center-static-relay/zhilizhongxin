#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
function main(){
  console.log(JSON.stringify({event:"L2_LOCAL_ROUTE_CANDIDATE_MODE",local_worker_execution:true,remote_expert_binding:true,worker_deployment_mutation:false,production_worker_traffic_changed:false,dynamic_route_acceptance:true,secrets_redacted:true}));
  const env={...process.env,CI:"1"};delete env.WRANGLER_CI_OVERRIDE_NAME;
  const result=spawnSync(process.execPath,[resolve(process.cwd(),"scripts/run-l2-candidate-acceptance-core.mjs")],{cwd:process.cwd(),encoding:"utf8",env,stdio:"inherit",timeout:12*60*1000,killSignal:"SIGKILL"});
  if(result.error||result.status!==0)throw new Error("L2_LOCAL_ROUTE_CANDIDATE_FAILED");
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href){try{main()}catch(error){console.error(JSON.stringify({event:"L2_WRAPPER_FAIL",error:String(error?.message||error),secrets_redacted:true}));process.exitCode=1}}
