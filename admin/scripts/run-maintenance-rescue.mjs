#!/usr/bin/env node
import {spawnSync} from "node:child_process";

const EXPECTED_BRANCH="agent/expert-candidate-pool-20260818";
const EXPECTED_MESSAGE="chore(admin): run maintenance rescue now";
const RESCUE_ROUND="small-flow-v1";

function fail(code,details={}){console.error(JSON.stringify({ok:false,code,...details}));process.exit(1)}
if(process.env.WORKERS_CI!=="1")fail("WORKERS_CI_REQUIRED");
if(process.env.WORKERS_CI_BRANCH!==EXPECTED_BRANCH)fail("CANDIDATE_BRANCH_REQUIRED",{branch:process.env.WORKERS_CI_BRANCH||null});
const msg=spawnSync("git",["log","-1","--pretty=%s"],{encoding:"utf8"});
if(msg.error||msg.status!==0)fail("HEAD_MESSAGE_UNAVAILABLE");
const headMessage=String(msg.stdout||"").trim();
if(headMessage!==EXPECTED_MESSAGE)fail("RESCUE_COMMIT_MESSAGE_MISMATCH",{head_message:headMessage});
console.log(JSON.stringify({event:"MAINTENANCE_RESCUE_BEGIN",round:RESCUE_ROUND,branch:EXPECTED_BRANCH,commit_sha:process.env.WORKERS_CI_COMMIT_SHA||null}));
const run=spawnSync(process.execPath,["scripts/run-immediate-refresh.mjs"],{cwd:"../maintenance",stdio:"inherit",env:process.env,encoding:"utf8"});
if(run.error||run.status!==0)fail("MAINTENANCE_RESCUE_FAILED",{round:RESCUE_ROUND,status:run.status??null,error:run.error?.message||null});
console.log(JSON.stringify({ok:true,code:"MAINTENANCE_RESCUE_COMPLETED",round:RESCUE_ROUND,commit_sha:process.env.WORKERS_CI_COMMIT_SHA||null}));
