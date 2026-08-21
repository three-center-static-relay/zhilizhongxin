#!/usr/bin/env node
const branch=String(process.env.WORKERS_CI_BRANCH||"");
const sha=String(process.env.WORKERS_CI_COMMIT_SHA||"");
if(process.env.WORKERS_CI!=="1"||!branch||branch==="main"||!/^[a-f0-9]{40,64}$/i.test(sha)){
  console.error(JSON.stringify({ok:false,event:"PREVIEW_CHANNEL_BASELINE_FAIL",secrets_redacted:true}));
  process.exitCode=1;
}else{
  console.log(JSON.stringify({ok:true,event:"PREVIEW_CHANNEL_BASELINE_PASS",commit_sha:sha,secrets_redacted:true}));
}
