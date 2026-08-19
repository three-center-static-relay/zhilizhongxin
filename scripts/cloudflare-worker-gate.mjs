#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCOPES = new Set(["admin", "governance", "maintenance"]);
const MODES = new Set(["preview", "deploy"]);
const SHARED_BUILD_PATHS = new Set([
  ".npmrc",
  "scripts/cloudflare-worker-gate.mjs",
  "scripts/cloudflare-worker-gate.test.mjs",
  "scripts/tencent-postdeploy-e2e.mjs",
]);
const SHA_PATTERN = /^[a-f0-9]{40,64}$/i;
const BRANCH_PATTERN = /^[0-9A-Za-z._/-]{1,255}$/;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const REQUIRED_TENCENT_CHECKS = [
  "stable_domain","runtime_http","python_runtime","executor_auth","capability_http",
  "sandbox_tools_visible","commands_visible","files_visible","code_visible","browser_visible",
  "active_selftest_http","shell_exec","file_rw_cleanup","python_exec","chromium_navigation"
];

export function validateInvocation(scope, mode, env = process.env) {
  if (!SCOPES.has(scope)) throw new Error(`UNSUPPORTED_SCOPE:${scope || "missing"}`);
  if (!MODES.has(mode)) throw new Error(`UNSUPPORTED_MODE:${mode || "missing"}`);
  if (env.WORKERS_CI !== "1") throw new Error("WORKERS_CI_REQUIRED");
  if (!SHA_PATTERN.test(env.WORKERS_CI_COMMIT_SHA || "")) throw new Error("VALID_COMMIT_SHA_REQUIRED");
  if (
    !BRANCH_PATTERN.test(env.WORKERS_CI_BRANCH || "") ||
    env.WORKERS_CI_BRANCH.includes("..") ||
    env.WORKERS_CI_BRANCH.endsWith("/")
  ) throw new Error("VALID_WORKERS_CI_BRANCH_REQUIRED");
  if (mode === "deploy" && env.WORKERS_CI_BRANCH !== "main") throw new Error("PRODUCTION_BRANCH_REQUIRED");
  if (mode === "preview" && env.WORKERS_CI_BRANCH === "main") throw new Error("PREVIEW_BRANCH_REQUIRED");
  return {branch: env.WORKERS_CI_BRANCH,sha: env.WORKERS_CI_COMMIT_SHA};
}

export function validateWranglerVersion(version) {
  if (!EXACT_VERSION_PATTERN.test(version || "")) throw new Error("EXACT_WRANGLER_VERSION_REQUIRED");
  return version;
}

export function isRelevantPath(scope, filePath) {
  if (!SCOPES.has(scope)) throw new Error(`UNSUPPORTED_SCOPE:${scope || "missing"}`);
  return filePath.startsWith(`${scope}/`) || SHARED_BUILD_PATHS.has(filePath);
}

export function relevantPaths(scope, paths) {
  return [...new Set(paths.filter((filePath) => isRelevantPath(scope, filePath)))].sort();
}

export function parseWorkersDevUrl(text) {
  const match=String(text||"").match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i);
  if(!match)throw new Error("WORKERS_DEV_URL_NOT_FOUND");
  const url=new URL(match[0]);
  if(url.protocol!=="https:"||!url.hostname.endsWith(".workers.dev"))throw new Error("INVALID_WORKERS_DEV_URL");
  return `${url.protocol}//${url.host}`;
}

export function validateTencentRuntimeReceipt(body) {
  if(body?.ok!==true)throw new Error("TENCENT_E2E_OK_REQUIRED");
  if(body?.validation!=="PASS")throw new Error("TENCENT_E2E_PASS_REQUIRED");
  if(body?.selftest!=="executor-runtime-v5")throw new Error("TENCENT_E2E_SELFTEST_VERSION_MISMATCH");
  if(!["project-domain","custom-domain"].includes(body?.resolved_executor?.mode))throw new Error("TENCENT_E2E_STABLE_DOMAIN_REQUIRED");
  if(!Array.isArray(body?.checks)||body.checks.length!==REQUIRED_TENCENT_CHECKS.length)throw new Error("TENCENT_E2E_CHECK_COUNT_MISMATCH");
  const checks=new Map(body.checks.map(check=>[check?.name,check]));
  for(const name of REQUIRED_TENCENT_CHECKS){
    if(checks.get(name)?.ok!==true)throw new Error(`TENCENT_E2E_CHECK_FAILED:${name}`);
  }
  return body;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding,
    env: options.env || process.env,
    maxBuffer: options.maxBuffer || 1024 * 1024,
    stdio: options.stdio,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${command.toUpperCase()}_FAILED`);
    error.exitCode = result.status || 1;
    error.stderr = result.stderr;
    error.stdout = result.stdout;
    throw error;
  }
  return result;
}

function repositoryRoot() {
  return run("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
}

function gitText(repoRoot, args) {
  return run("git", args, { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
}

function gitObjectExists(repoRoot, object) {
  const result = spawnSync("git", ["cat-file", "-e", object], {
    cwd: repoRoot,encoding: "utf8",env: process.env,stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

function fetchParentHistory(repoRoot, sha, branch, parentSha) {
  const refspecs = [`refs/heads/${branch}`, sha];
  for (const refspec of refspecs) {
    const result = spawnSync("git",["fetch", "--no-tags", "--depth=2", "origin", refspec],{cwd:repoRoot,encoding:"utf8",env:process.env});
    if (!result.error && result.status === 0 && gitObjectExists(repoRoot, `${parentSha}^{commit}`)) return true;
  }
  return false;
}

function diffContext(repoRoot, sha, branch) {
  const headSha = gitText(repoRoot, ["rev-parse", "HEAD"]);
  if (headSha !== sha) throw new Error("HEAD_COMMIT_MISMATCH");
  const commitObject = run("git", ["cat-file", "-p", sha], {cwd:repoRoot,encoding:"utf8"}).stdout;
  const parentSha = commitObject.match(/^parent ([a-f0-9]{40,64})$/im)?.[1];
  if (!SHA_PATTERN.test(parentSha || "")) throw new Error("PARENT_COMMIT_REQUIRED");
  let historyDeepened = false;
  if (!gitObjectExists(repoRoot, `${parentSha}^{commit}`)) historyDeepened = fetchParentHistory(repoRoot, sha, branch, parentSha);
  if (!gitObjectExists(repoRoot, `${parentSha}^{commit}`)) throw new Error("PARENT_COMMIT_UNAVAILABLE");
  return { parentSha, historyDeepened };
}

function changedPaths(repoRoot, parentSha, sha) {
  const output = run("git",["diff", "--name-only", "-z", parentSha, sha],{cwd:repoRoot,encoding:"utf8",maxBuffer:4*1024*1024}).stdout;
  return output.split("\0").filter(Boolean);
}

function packageContract(scope) {
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
  if (packageJson.name !== `${scope}-worker`) throw new Error("WORKER_PACKAGE_SCOPE_MISMATCH");
  return {wranglerVersion: validateWranglerVersion(packageJson.devDependencies?.wrangler)};
}

function emit(payload, stream = process.stdout) {stream.write(`${JSON.stringify(payload)}\n`)}
function printCaptured(result){if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr)}

function rollbackAdmin(wranglerVersion){
  try{
    run("npx",["--yes",`wrangler@${wranglerVersion}`,"rollback","--message","Automatic rollback: Tencent runtime E2E failed"],{cwd:process.cwd(),stdio:"inherit"});
    emit({ok:true,code:"ADMIN_AUTOMATIC_ROLLBACK_COMPLETE"},process.stderr);
    return true;
  }catch(error){
    emit({ok:false,code:"ADMIN_AUTOMATIC_ROLLBACK_FAILED",error:String(error?.message||error)},process.stderr);
    return false;
  }
}

function deployAdminWithRuntimeE2E(repoRoot,wranglerVersion,context){
  const probe=randomBytes(32).toString("hex");
  let deployResult;
  try{
    deployResult=run("npx",[
      "--yes",`wrangler@${wranglerVersion}`,"deploy",
      "--define",`TENCENT_DEPLOY_E2E_PROBE:'${probe}'`
    ],{cwd:process.cwd(),encoding:"utf8",maxBuffer:4*1024*1024});
    printCaptured(deployResult);
  }catch(error){
    if(error.stdout)process.stdout.write(error.stdout);
    if(error.stderr)process.stderr.write(error.stderr);
    throw error;
  }

  let workerUrl;
  try{workerUrl=parseWorkersDevUrl(`${deployResult.stdout||""}\n${deployResult.stderr||""}`)}
  catch(error){
    rollbackAdmin(wranglerVersion);
    throw error;
  }

  const verify=spawnSync(process.execPath,[resolve(repoRoot,"scripts/tencent-postdeploy-e2e.mjs"),workerUrl],{
    cwd:repoRoot,encoding:"utf8",env:{...process.env,TENCENT_E2E_PROBE_TOKEN:probe},maxBuffer:4*1024*1024
  });
  printCaptured(verify);
  if(verify.error){rollbackAdmin(wranglerVersion);throw verify.error}
  if(verify.status!==0){
    const rolledBack=rollbackAdmin(wranglerVersion);
    const error=new Error(rolledBack?"TENCENT_RUNTIME_E2E_FAILED_ROLLED_BACK":"TENCENT_RUNTIME_E2E_FAILED_ROLLBACK_FAILED");
    error.exitCode=verify.status||1;
    throw error;
  }
  emit({ok:true,code:"TENCENT_RUNTIME_E2E_DEPLOY_GATE_PASS",commit_sha:context.sha,worker_host:new URL(workerUrl).host,probe_persisted:false});
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const [scope, mode] = argv;
  try {
    const context = validateInvocation(scope, mode, env);
    const repoRoot = repositoryRoot();
    const { parentSha, historyDeepened } = diffContext(repoRoot, context.sha, context.branch);
    const changed = changedPaths(repoRoot, parentSha, context.sha);
    const relevant = relevantPaths(scope, changed);

    if (relevant.length === 0) {
      emit({ok:true,skipped:true,code:"CF_PATH_SCOPE_SKIPPED",scope,mode,branch:context.branch,commit_sha:context.sha,parent_sha:parentSha,history_deepened:historyDeepened,changed_path_count:changed.length});
      return 0;
    }

    const { wranglerVersion } = packageContract(scope);
    emit({ok:true,skipped:false,code:"CF_PATH_SCOPE_ALLOWED",scope,mode,branch:context.branch,commit_sha:context.sha,parent_sha:parentSha,history_deepened:historyDeepened,relevant_paths:relevant,wrangler_version:wranglerVersion});

    run(process.execPath,[resolve(repoRoot,"scripts/cloudflare-worker-gate.test.mjs")],{cwd:repoRoot,stdio:"inherit"});
    run("npm",["run","cf:build"],{cwd:process.cwd(),stdio:"inherit"});

    if(mode==="preview"){
      run("npx",["--yes",`wrangler@${wranglerVersion}`,"deploy","--dry-run"],{cwd:process.cwd(),stdio:"inherit"});
    }else if(scope==="admin"){
      deployAdminWithRuntimeE2E(repoRoot,wranglerVersion,context);
    }else{
      run("npx",["--yes",`wrangler@${wranglerVersion}`,"deploy"],{cwd:process.cwd(),stdio:"inherit"});
    }
    return 0;
  } catch (error) {
    emit({ok:false,skipped:false,code:error.message||"CF_PATH_GATE_FAILED",scope:scope||null,mode:mode||null},process.stderr);
    return Number.isInteger(error.exitCode)?error.exitCode:1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) process.exitCode = main();
