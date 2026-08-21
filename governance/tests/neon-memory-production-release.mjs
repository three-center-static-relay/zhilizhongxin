import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

const BASE_MAIN="e1784482de742cb38f58d93ea0a076464a83cb2a";
assert.equal(process.env.WORKERS_CI,"1","WORKERS_CI_REQUIRED");
assert.notEqual(process.env.WORKERS_CI_BRANCH,"main","PREVIEW_BRANCH_REQUIRED");
assert.match(String(process.env.WORKERS_CI_COMMIT_SHA||""),/^[a-f0-9]{40,64}$/i,"VALID_COMMIT_SHA_REQUIRED");
function run(command,args,{cwd=process.cwd(),env=process.env,stdio="pipe"}={}){const r=spawnSync(command,args,{cwd,env,encoding:"utf8",maxBuffer:16*1024*1024,stdio});assert.equal(r.error,undefined,`${command.toUpperCase()}_START_FAILED`);return r}
const root=run("git",["rev-parse","--show-toplevel"]).stdout.trim();
let base=run("git",["cat-file","-e",`${BASE_MAIN}^{commit}`],{cwd:root});
if(base.status!==0){const fetch=run("git",["fetch","--no-tags","--depth=1","origin",BASE_MAIN],{cwd:root});assert.equal(fetch.status,0,"BASE_MAIN_FETCH_FAILED");base=run("git",["cat-file","-e",`${BASE_MAIN}^{commit}`],{cwd:root})}
assert.equal(base.status,0,"BASE_MAIN_UNAVAILABLE");
const runtimeDiff=run("git",["diff","--name-only",BASE_MAIN,"HEAD","--","governance/src","governance/wrangler.jsonc"],{cwd:root});assert.equal(runtimeDiff.status,0,"RUNTIME_DIFF_FAILED");assert.equal(runtimeDiff.stdout.trim(),"","RELEASE_BRANCH_RUNTIME_DIFFERS_FROM_MAIN");
const child=spawnSync(process.execPath,[resolve("scripts/versioned-production-deploy.mjs")],{cwd:process.cwd(),env:{...process.env,WORKERS_CI_BRANCH:"main"},encoding:"utf8",maxBuffer:24*1024*1024});
if(child.stdout)process.stdout.write(child.stdout);if(child.stderr)process.stderr.write(child.stderr);assert.equal(child.error,undefined,"PRODUCTION_SCRIPT_START_FAILED");assert.equal(child.status,0,"EXACT_MAIN_NEON_RUNTIME_PROMOTION_FAILED");
console.log(JSON.stringify({ok:true,suite:"governance-neon-memory-production-release",base_main:BASE_MAIN,runtime_exact_main:true,promotion_100_percent:true,rollback_on_failure:true,secrets_redacted:true}));
