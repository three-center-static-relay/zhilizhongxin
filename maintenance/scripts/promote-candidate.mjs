#!/usr/bin/env node
import {spawnSync} from "node:child_process";

const EXPECTED_BRANCH="agent/expert-candidate-pool-20260818";
const SHA=/^[a-f0-9]{40,64}$/i;
function fail(code){console.error(JSON.stringify({ok:false,code}));process.exit(1)}
if(process.env.WORKERS_CI!=="1")fail("WORKERS_CI_REQUIRED");
if(process.env.WORKERS_CI_BRANCH!==EXPECTED_BRANCH)fail("CANDIDATE_BRANCH_REQUIRED");
if(!SHA.test(process.env.WORKERS_CI_COMMIT_SHA||""))fail("VALID_COMMIT_SHA_REQUIRED");
const args=["--yes","wrangler@4.123.0","deploy"];
const r=spawnSync("npx",args,{stdio:"inherit",env:process.env,encoding:"utf8"});
if(r.error||r.status!==0)fail("CANDIDATE_DEPLOY_FAILED");
console.log(JSON.stringify({ok:true,code:"MAINTENANCE_CANDIDATE_DEPLOYED",branch:EXPECTED_BRANCH,commit_sha:process.env.WORKERS_CI_COMMIT_SHA}));
