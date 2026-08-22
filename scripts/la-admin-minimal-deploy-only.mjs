#!/usr/bin/env node
import {spawnSync} from "node:child_process";
const r=spawnSync("npx",["wrangler","deploy","--config","wrangler.la-deploy-smoke.jsonc"],{stdio:"inherit",encoding:"utf8"});
if(r.error){console.error(JSON.stringify({ok:false,code:"LA_ADMIN_MINIMAL_DEPLOY_SPAWN_FAILED",error:String(r.error?.message||r.error),secrets_redacted:true}));process.exitCode=1}else if(r.status!==0){console.error(JSON.stringify({ok:false,code:"LA_ADMIN_MINIMAL_DEPLOY_FAILED",exit_status:r.status,secrets_redacted:true}));process.exitCode=r.status||1}else console.log(JSON.stringify({ok:true,code:"LA_ADMIN_MINIMAL_DEPLOY_PASS",worker:"admin-la-deploy-smoke-worker",cleanup_pending:true,secrets_redacted:true}));
