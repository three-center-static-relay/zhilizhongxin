import assert from "node:assert/strict";

import {
  isRelevantPath,
  relevantPaths,
  validateInvocation,
  validateWranglerVersion,
} from "./cloudflare-worker-gate.mjs";

const previewEnv = {
  WORKERS_CI: "1",
  WORKERS_CI_BRANCH: "feature/gate",
  WORKERS_CI_COMMIT_SHA: "a".repeat(40),
};
const deployEnv = {
  ...previewEnv,
  WORKERS_CI_BRANCH: "main",
};

assert.deepEqual(validateInvocation("admin", "preview", previewEnv), {
  branch: "feature/gate",
  sha: "a".repeat(40),
});
assert.deepEqual(validateInvocation("governance", "deploy", deployEnv), {
  branch: "main",
  sha: "a".repeat(40),
});
assert.throws(() => validateInvocation("admin", "deploy", previewEnv), /PRODUCTION_BRANCH_REQUIRED/);
assert.throws(() => validateInvocation("admin", "preview", deployEnv), /PREVIEW_BRANCH_REQUIRED/);
assert.throws(() => validateInvocation("unknown", "preview", previewEnv), /UNSUPPORTED_SCOPE/);
assert.throws(() => validateInvocation("admin", "preview", { ...previewEnv, WORKERS_CI: "0" }), /WORKERS_CI_REQUIRED/);
assert.throws(() => validateInvocation("admin", "preview", { ...previewEnv, WORKERS_CI_COMMIT_SHA: "bad" }), /VALID_COMMIT_SHA_REQUIRED/);
assert.throws(() => validateInvocation("admin", "preview", { ...previewEnv, WORKERS_CI_BRANCH: "../bad" }), /VALID_WORKERS_CI_BRANCH_REQUIRED/);

assert.equal(validateWranglerVersion("4.123.0"), "4.123.0");
assert.throws(() => validateWranglerVersion("^4.123.0"), /EXACT_WRANGLER_VERSION_REQUIRED/);

assert.equal(isRelevantPath("admin", "admin/src/index.js"), true);
assert.equal(isRelevantPath("admin", "governance/src/index.js"), false);
assert.equal(isRelevantPath("governance", "admin/docs/canary.md"), false);
assert.equal(isRelevantPath("governance", "governance/docs/canary.md"), true);
assert.equal(isRelevantPath("maintenance", ".npmrc"), true);
assert.equal(isRelevantPath("maintenance", "scripts/cloudflare-worker-gate.mjs"), true);
assert.deepEqual(
  relevantPaths("governance", [
    "admin/a.js",
    "governance/z.js",
    "governance/a.js",
    "governance/a.js",
  ]),
  ["governance/a.js", "governance/z.js"],
);

console.log(JSON.stringify({
  ok: true,
  suite: "cloudflare-worker-gate-contract",
  fail_closed_context: true,
  exact_wrangler_pin: true,
  per_worker_path_isolation: true,
}));
