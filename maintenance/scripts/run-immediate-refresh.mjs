#!/usr/bin/env node
import {spawnSync} from "node:child_process";

const WRANGLER="4.123.0";
const TEMP_CONFIG="wrangler.immediate.jsonc";
const NORMAL_CONFIG="wrangler.jsonc";
const URL="https://maintenance-worker.a15280020511.workers.dev/v1/maintenance/refresh-now";
const NONCE="ee02358eee7f6ebee792faff0bac40467857320879e9919740f9d1bac7869ffb";

function run(args){
  const r=spawnSync("npx",["--yes",`wrangler@${WRANGLER}`,...args],{stdio:"inherit",env:process.env,encoding:"utf8"});
  if(r.error||r.status!==0)throw new Error(`WRANGLER_FAILED:${args.join(" ")}`);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function invoke(){
  let last=null;
  for(let attempt=1;attempt<=8;attempt++){
    try{
      const response=await fetch(URL,{method:"POST",headers:{"x-immediate-refresh-nonce":NONCE,"accept":"application/json"}});
      const text=await response.text();
      let body=null;try{body=text?JSON.parse(text):null}catch{}
      console.log(JSON.stringify({event:"IMMEDIATE_REFRESH_RESPONSE",attempt,http_status:response.status,body}));
      if(response.ok&&body?.ok===true)return body;
      if(response.status===409){last=new Error("IMMEDIATE_REFRESH_BUSY");await sleep(4000);continue;}
      throw Object.assign(new Error("IMMEDIATE_REFRESH_REJECTED"),{details:{status:response.status,body}});
    }catch(error){
      last=error;
      if(String(error?.message||"").includes("IMMEDIATE_REFRESH_REJECTED"))throw error;
      if(attempt<8){await sleep(4000);continue;}
    }
  }
  throw last||new Error("IMMEDIATE_REFRESH_FAILED");
}

let primaryError=null;
let result=null;
try{
  console.log(JSON.stringify({event:"TEMP_WORKERS_DEV_DEPLOY_BEGIN"}));
  run(["deploy","--config",TEMP_CONFIG]);
  await sleep(3000);
  result=await invoke();
  console.log(JSON.stringify({event:"IMMEDIATE_REFRESH_PASS",result}));
}catch(error){
  primaryError=error;
  console.error(JSON.stringify({event:"IMMEDIATE_REFRESH_FAIL",error:String(error?.message||error),details:error?.details||null}));
}finally{
  console.log(JSON.stringify({event:"NORMAL_DEPLOY_RESTORE_BEGIN"}));
  try{run(["deploy","--config",NORMAL_CONFIG]);console.log(JSON.stringify({event:"NORMAL_DEPLOY_RESTORED"}));}
  catch(error){console.error(JSON.stringify({event:"NORMAL_DEPLOY_RESTORE_FAILED",error:String(error?.message||error)}));if(!primaryError)primaryError=error;}
}
if(primaryError)process.exitCode=1;
else console.log(JSON.stringify({ok:true,code:"IMMEDIATE_EXPERT_ROUTE_REFRESH_COMPLETED",route_status:result?.result?.status||null,route_id:result?.result?.route_id||null,version_id:result?.result?.version_id||null,previous_version_id:result?.result?.previous_version_id||null,selftest:result?.result?.selftest||null,secrets_redacted:true}));
