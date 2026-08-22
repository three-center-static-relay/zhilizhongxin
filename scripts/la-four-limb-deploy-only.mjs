#!/usr/bin/env node
import {spawnSync} from "node:child_process";
const CONFIG="wrangler.la-four-limb-canary.jsonc";
const r=spawnSync("npx",["wrangler","deploy","--config",CONFIG],{stdio:"inherit",encoding:"utf8"});
if(r.error){console.error(JSON.stringify({ok:false,code:"LA_CANARY_DEPLOY_SPAWN_FAILED",error:String(r.error?.message||r.error),secrets_redacted:true}));process.exitCode=1}else if(r.status!==0){console.error(JSON.stringify({ok:false,code:"LA_CANARY_DEPLOY_ONLY_FAILED",exit_status:r.status,secrets_redacted:true}));process.exitCode=r.status||1}else console.log(JSON.stringify({ok:true,code:"LA_CANARY_DEPLOY_ONLY_PASS",worker:"admin-la-four-limb-canary-worker",cleanup_pending:true,secrets_redacted:true}));
