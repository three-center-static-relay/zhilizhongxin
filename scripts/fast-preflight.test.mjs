import assert from "node:assert/strict";
import { resolveRequestedScopes, scopesForPaths, validatePackageContract } from "./fast-preflight.mjs";

const pkg = (scope, version = "4.123.0", preview = "npm run cf:build && npx wrangler deploy --dry-run") => ({
  name: `${scope}-worker`,
  scripts: { "cf:build": "node --check src/index.js", "cf:preview": preview },
  devDependencies: { wrangler: version },
});

assert.deepEqual(scopesForPaths(["governance/src/index.js"]), ["governance"]);
assert.deepEqual(scopesForPaths(["admin/src/index.js", "maintenance/src/index.js"]), ["admin", "maintenance"]);
assert.deepEqual(scopesForPaths(["scripts/cloudflare-worker-gate.mjs"]), ["governance", "admin", "maintenance"]);
assert.deepEqual(scopesForPaths(["README.md"]), []);
assert.deepEqual(resolveRequestedScopes(["all"], []), ["governance", "admin", "maintenance"]);
assert.deepEqual(resolveRequestedScopes(["maintenance", "governance"], []), ["governance", "maintenance"]);
assert.equal(validatePackageContract("governance", pkg("governance")).wranglerVersion, "4.123.0");
assert.throws(() => validatePackageContract("governance", pkg("governance", "^4.123.0")), /EXACT_WRANGLER_VERSION_REQUIRED/);
assert.throws(() => validatePackageContract("maintenance", pkg("maintenance", "4.123.0", "npm run cf:build && npx wrangler versions upload")), /SAFE_CF_PREVIEW_REQUIRED/);
assert.throws(() => validatePackageContract("maintenance", pkg("maintenance", "4.123.0", "npm run cf:build && node scripts\/run-immediate-refresh.mjs")), /SAFE_CF_PREVIEW_REQUIRED/);

console.log(JSON.stringify({ ok: true, suite: "fast-preflight-contract", targeted_scopes: true, dry_run_only: true, side_effecting_preview_rejected: true }));
