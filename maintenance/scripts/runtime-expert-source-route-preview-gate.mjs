#!/usr/bin/env node
import {spawnSync} from "node:child_process";
const branch=String(process.env.WORKERS_CI_BRANCH||"");
const sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
function fail(code){console.error(JSON.stringify({ok:false,event:code,secrets_redacted:true}));process.exitCode=1}
if(process.env.WORKERS_CI!=="1"||!branch||branch==="main"||!/^[a-f0-9]{40,64}$/i.test(sha))fail("PREVIEW_BUILD_BASELINE_ENV_FAIL");
else{
  const r=spawnSync("npm",["run","cf:build"],{cwd:process.cwd(),env:process.env,encoding:"utf8",stdio:"inherit",maxBuffer:12*1024*1024});
  if(r.error||r.status!==0)fail("PREVIEW_BUILD_BASELINE_CF_BUILD_FAIL");
  else console.log(JSON.stringify({ok:true,event:"PREVIEW_BUILD_BASELINE_PASS",commit_sha:sha,secrets_redacted:true}));
}
