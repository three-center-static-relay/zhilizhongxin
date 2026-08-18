#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCOPES = new Set(["admin", "governance", "maintenance"]);
const MODES = new Set(["preview", "deploy"]);
const SHARED_BUILD_PATHS = new Set([".npmrc","scripts/cloudflare-worker-gate.mjs","scripts/cloudflare-worker-gate.test.mjs"]);
const SHA_PATTERN = /^[a-f0-9]{40,64}$/i;
const BRANCH_PATTERN = /^[0-9A-Za-z._/-]{1,255}$/;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function validateInvocation(scope, mode, env = process.env) {
  if (!SCOPES.has(scope)) throw new Error(`UNSUPPORTED_SCOPE:${scope || "missing"}`);
  if (!MODES.has(mode)) throw new Error(`UNSUPPORTED_MODE:${mode || "missing"}`);
  if (env.WORKERS_CI !== "1") throw new Error("WORKERS_CI_REQUIRED");
  if (!SHA_PATTERN.test(env.WORKERS_CI_COMMIT_SHA || "")) throw new Error("VALID_COMMIT_SHA_REQUIRED");
  if (!BRANCH_PATTERN.test(env.WORKERS_CI_BRANCH || "") || env.WORKERS_CI_BRANCH.includes("..") || env.WORKERS_CI_BRANCH.endsWith("/")) throw new Error("VALID_WORKERS_CI_BRANCH_REQUIRED");
  if (mode === "deploy" && env.WORKERS_CI_BRANCH !== "main") throw new Error("PRODUCTION_BRANCH_REQUIRED");
  if (mode === "preview" && env.WORKERS_CI_BRANCH === "main") throw new Error("PREVIEW_BRANCH_REQUIRED");
  return { branch: env.WORKERS_CI_BRANCH, sha: env.WORKERS_CI_COMMIT_SHA };
}
export function validateWranglerVersion(version) { if (!EXACT_VERSION_PATTERN.test(version || "")) throw new Error("EXACT_WRANGLER_VERSION_REQUIRED"); return version; }
export function validatePostAllowScript(scope, mode, requested = null) {
  if (!requested) return null;
  if (!SCOPES.has(scope) || !MODES.has(mode)) throw new Error("POST_ALLOW_SCRIPT_NOT_ALLOWED");
  throw new Error("POST_ALLOW_SCRIPT_NOT_ALLOWED");
}
export function isRelevantPath(scope, filePath) { if (!SCOPES.has(scope)) throw new Error(`UNSUPPORTED_SCOPE:${scope || "missing"}`); return filePath.startsWith(`${scope}/`) || SHARED_BUILD_PATHS.has(filePath); }
export function relevantPaths(scope, paths) { return [...new Set(paths.filter((filePath) => isRelevantPath(scope, filePath)))].sort(); }
export function wranglerCommand(scope, mode, wranglerVersion, context) {
  validateWranglerVersion(wranglerVersion);
  if (!SCOPES.has(scope)) throw new Error(`UNSUPPORTED_SCOPE:${scope || "missing"}`);
  if (mode === "preview") {
    if (scope === "admin" || scope === "maintenance") {
      const shortSha=String(context?.sha||"").slice(0,12);
      return ["--yes",`wrangler@${wranglerVersion}`,"versions","upload","--tag",shortSha,"--message",`candidate ${context?.branch||"preview"} ${shortSha}`];
    }
    return ["--yes",`wrangler@${wranglerVersion}`,"deploy","--dry-run"];
  }
  if (mode === "deploy") return ["--yes",`wrangler@${wranglerVersion}`,"deploy"];
  throw new Error(`UNSUPPORTED_MODE:${mode || "missing"}`);
}
function run(command,args,options={}){const result=spawnSync(command,args,{cwd:options.cwd,encoding:options.encoding,env:process.env,maxBuffer:options.maxBuffer||1024*1024,stdio:options.stdio});if(result.error)throw result.error;if(result.status!==0){const error=new Error(`${command.toUpperCase()}_FAILED`);error.exitCode=result.status||1;error.stderr=result.stderr;throw error}return result}
function repositoryRoot(){return run("git",["rev-parse","--show-toplevel"],{encoding:"utf8"}).stdout.trim()}
function gitText(repoRoot,args){return run("git",args,{cwd:repoRoot,encoding:"utf8"}).stdout.trim()}
function gitObjectExists(repoRoot,object){const result=spawnSync("git",["cat-file","-e",object],{cwd:repoRoot,encoding:"utf8",env:process.env,stdio:"ignore"});return !result.error&&result.status===0}
function fetchParentHistory(repoRoot,sha,branch,parentSha){const refspecs=[`refs/heads/${branch}`,sha];for(const refspec of refspecs){const result=spawnSync("git",["fetch","--no-tags","--depth=2","origin",refspec],{cwd:repoRoot,encoding:"utf8",env:process.env});if(!result.error&&result.status===0&&gitObjectExists(repoRoot,`${parentSha}^{commit}`))return true}return false}
function diffContext(repoRoot,sha,branch){const headSha=gitText(repoRoot,["rev-parse","HEAD"]);if(headSha!==sha)throw new Error("HEAD_COMMIT_MISMATCH");const commitObject=run("git",["cat-file","-p",sha],{cwd:repoRoot,encoding:"utf8"}).stdout;const parentSha=commitObject.match(/^parent ([a-f0-9]{40,64})$/im)?.[1];if(!SHA_PATTERN.test(parentSha||""))throw new Error("PARENT_COMMIT_REQUIRED");let historyDeepened=false;if(!gitObjectExists(repoRoot,`${parentSha}^{commit}`))historyDeepened=fetchParentHistory(repoRoot,sha,branch,parentSha);if(!gitObjectExists(repoRoot,`${parentSha}^{commit}`))throw new Error("PARENT_COMMIT_UNAVAILABLE");return{parentSha,historyDeepened}}
function changedPaths(repoRoot,parentSha,sha){const output=run("git",["diff","--name-only","-z",parentSha,sha],{cwd:repoRoot,encoding:"utf8",maxBuffer:4*1024*1024}).stdout;return output.split("\0").filter(Boolean)}
function packageContract(scope){const packageJson=JSON.parse(readFileSync(resolve(process.cwd(),"package.json"),"utf8"));if(packageJson.name!==`${scope}-worker`)throw new Error("WORKER_PACKAGE_SCOPE_MISMATCH");return{wranglerVersion:validateWranglerVersion(packageJson.devDependencies?.wrangler)}}
function emit(payload,stream=process.stdout){stream.write(`${JSON.stringify(payload)}\n`)}
export function main(argv=process.argv.slice(2),env=process.env){
  const[scope,mode,requestedPostAllowScript]=argv;
  try{
    const context=validateInvocation(scope,mode,env);
    validatePostAllowScript(scope,mode,requestedPostAllowScript);
    const repoRoot=repositoryRoot(),{parentSha,historyDeepened}=diffContext(repoRoot,context.sha,context.branch),changed=changedPaths(repoRoot,parentSha,context.sha),relevant=relevantPaths(scope,changed);
    if(relevant.length===0){emit({ok:true,skipped:true,code:"CF_PATH_SCOPE_SKIPPED",scope,mode,branch:context.branch,commit_sha:context.sha,parent_sha:parentSha,history_deepened:historyDeepened,changed_path_count:changed.length,post_allow_executed:false});return 0}
    const{wranglerVersion}=packageContract(scope);
    const previewSemantics=mode==="preview"?(scope==="admin"||scope==="maintenance"?"version-upload-no-production-deploy":"compile-dry-run-only"):"production-deploy";
    emit({ok:true,skipped:false,code:"CF_PATH_SCOPE_ALLOWED",scope,mode,branch:context.branch,commit_sha:context.sha,parent_sha:parentSha,history_deepened:historyDeepened,relevant_paths:relevant,wrangler_version:wranglerVersion,preview_semantics:previewSemantics,candidate_tag:mode==="preview"&&(scope==="admin"||scope==="maintenance")?context.sha.slice(0,12):null,post_allow_script:null});
    run(process.execPath,[resolve(repoRoot,"scripts/cloudflare-worker-gate.test.mjs")],{cwd:repoRoot,stdio:"inherit"});
    run("npm",["run","cf:build"],{cwd:process.cwd(),stdio:"inherit"});
    run("npx",wranglerCommand(scope,mode,wranglerVersion,context),{cwd:process.cwd(),stdio:"inherit"});
    return 0;
  }catch(error){emit({ok:false,skipped:false,code:error.message||"CF_PATH_GATE_FAILED",scope:scope||null,mode:mode||null},process.stderr);return Number.isInteger(error.exitCode)?error.exitCode:1}
}
const invokedPath=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invokedPath)process.exitCode=main();
