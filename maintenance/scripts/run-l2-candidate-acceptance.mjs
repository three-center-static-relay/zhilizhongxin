#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
function main(){
  console.log(JSON.stringify({event:"L2_STATELESS_VERSION_PREVIEW_PROBE_MODE",stateless_worker:true,durable_object_implemented:false,preview_url:true,production_deployment_created:false,production_traffic_changed:false,temporary_worker_delete_required:true,secret_used:false,ai_gateway_called:false,dynamic_routes_mutated:false,secrets_redacted:true}));
  const env={...process.env,CI:"1"};delete env.WRANGLER_CI_OVERRIDE_NAME;
  const result=spawnSync(process.execPath,[resolve(process.cwd(),"scripts/run-l2-candidate-acceptance-core.mjs")],{cwd:process.cwd(),encoding:"utf8",env,stdio:"inherit",timeout:6*60*1000,killSignal:"SIGKILL"});
  if(result.error||result.status!==0)throw new Error("L2_STATELESS_PREVIEW_PROBE_FAILED");
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href){try{main()}catch(error){console.error(JSON.stringify({event:"L2_WRAPPER_FAIL",error:String(error?.message||error),secrets_redacted:true}));process.exitCode=1}}
