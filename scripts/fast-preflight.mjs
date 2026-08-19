#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCOPES = Object.freeze(["governance", "admin", "maintenance"]);
const SCOPE_SET = new Set(SCOPES);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SAFE_PREVIEW = "npm run cf:build && npx wrangler deploy --dry-run";
const SHARED_PREFLIGHT_PATHS = new Set([
  ".npmrc",
  "scripts/cloudflare-worker-gate.mjs",
  "scripts/cloudflare-worker-gate.test.mjs",
  "scripts/fast-preflight.mjs",
  "scripts/fast-preflight.test.mjs",
]);

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    stdio: options.stdio || "inherit",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${String(command).toUpperCase()}_FAILED`);
    error.exitCode = result.status || 1;
    throw error;
  }
  return result;
}

function gitText(repoRoot, args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", env: process.env });
  if (result.error || result.status !== 0) return "";
  return result.stdout.trim();
}

export function scopesForPaths(paths) {
  const unique = new Set((Array.isArray(paths) ? paths : []).filter(Boolean));
  if ([...unique].some((path) => SHARED_PREFLIGHT_PATHS.has(path))) return [...SCOPES];
  return SCOPES.filter((scope) => [...unique].some((path) => path.startsWith(`${scope}/`)));
}

export function validatePackageContract(scope, packageJson) {
  if (!SCOPE_SET.has(scope)) throw new Error(`UNSUPPORTED_SCOPE:${scope}`);
  if (packageJson?.name !== `${scope}-worker`) throw new Error(`PACKAGE_SCOPE_MISMATCH:${scope}`);
  const version = String(packageJson?.devDependencies?.wrangler || "");
  if (!EXACT_VERSION.test(version)) throw new Error(`EXACT_WRANGLER_VERSION_REQUIRED:${scope}`);
  if (!packageJson?.scripts?.["cf:build"]) throw new Error(`CF_BUILD_REQUIRED:${scope}`);
  const preview = String(packageJson?.scripts?.["cf:preview"] || "");
  if (preview !== SAFE_PREVIEW) throw new Error(`SAFE_CF_PREVIEW_REQUIRED:${scope}`);
  if (/versions\s+upload|run-immediate-refresh|cf:ci:preview/.test(preview)) {
    throw new Error(`SIDE_EFFECTING_PREVIEW_FORBIDDEN:${scope}`);
  }
  return { wranglerVersion: version, preview };
}

export function resolveRequestedScopes(args, changedPaths = []) {
  const requested = (Array.isArray(args) ? args : []).filter(Boolean);
  if (requested.length === 0 || requested[0] === "changed") return scopesForPaths(changedPaths);
  if (requested.length === 1 && requested[0] === "all") return [...SCOPES];
  const unique = [...new Set(requested)];
  for (const scope of unique) if (!SCOPE_SET.has(scope)) throw new Error(`UNSUPPORTED_SCOPE:${scope}`);
  return SCOPES.filter((scope) => unique.includes(scope));
}

function repositoryRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", env: process.env });
  if (result.error || result.status !== 0) throw new Error("GIT_REPOSITORY_REQUIRED");
  return result.stdout.trim();
}

function detectChangedPaths(repoRoot) {
  const current = gitText(repoRoot, ["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean);
  const untracked = gitText(repoRoot, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  const working = [...new Set([...current, ...untracked])];
  if (working.length) return working;
  return gitText(repoRoot, ["diff", "--name-only", "HEAD^", "HEAD"]).split("\n").filter(Boolean);
}

function emit(payload, stream = process.stdout) {
  stream.write(`${JSON.stringify(payload)}\n`);
}

export function main(args = process.argv.slice(2)) {
  const started = Date.now();
  try {
    const repoRoot = repositoryRoot();
    const changedPaths = detectChangedPaths(repoRoot);
    const scopes = resolveRequestedScopes(args, changedPaths);
    if (scopes.length === 0) {
      emit({ ok: true, code: "FAST_PREFLIGHT_NO_WORKER_CHANGES", changed_path_count: changedPaths.length, elapsed_ms: Date.now() - started });
      return 0;
    }

    run(process.execPath, [resolve(repoRoot, "scripts/cloudflare-worker-gate.test.mjs")], { cwd: repoRoot });
    run(process.execPath, [resolve(repoRoot, "scripts/fast-preflight.test.mjs")], { cwd: repoRoot });

    const receipts = [];
    for (const scope of scopes) {
      const scopeStarted = Date.now();
      const cwd = resolve(repoRoot, scope);
      const packageJson = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
      const { wranglerVersion } = validatePackageContract(scope, packageJson);
      run(commandName("npm"), ["run", "cf:build"], { cwd });
      run(commandName("npx"), ["--yes", `wrangler@${wranglerVersion}`, "deploy", "--dry-run"], { cwd });
      receipts.push({ scope, ok: true, wrangler_version: wranglerVersion, cloudflare_build_triggered: false, side_effects: false, elapsed_ms: Date.now() - scopeStarted });
    }

    emit({ ok: true, code: "FAST_PREFLIGHT_PASS", scopes, receipts, cloudflare_build_triggered: false, elapsed_ms: Date.now() - started });
    return 0;
  } catch (error) {
    emit({ ok: false, code: error?.message || "FAST_PREFLIGHT_FAILED", cloudflare_build_triggered: false, elapsed_ms: Date.now() - started }, process.stderr);
    return Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invoked) process.exitCode = main();
