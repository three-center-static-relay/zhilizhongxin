import assert from "node:assert/strict";
import {isSafePreviewDeployCommand,previewDeployCommandKind} from "../src/cloudflare-builds.js";

// Transitional recognition remains only until the external Cloudflare projects
// have been migrated. Dry-run is the preferred non-mutating command.
assert.equal(isSafePreviewDeployCommand("npx wrangler versions upload"),true);
assert.equal(previewDeployCommandKind("npx wrangler versions upload"),"legacy-version-upload");
assert.equal(isSafePreviewDeployCommand("wrangler versions upload --strict"),true);
assert.equal(previewDeployCommandKind("wrangler versions upload --strict"),"legacy-version-upload");

assert.equal(isSafePreviewDeployCommand("npx wrangler deploy --dry-run"),true);
assert.equal(previewDeployCommandKind("npx wrangler deploy --dry-run"),"dry-run");
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy --dry-run --outdir dist"),true);
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy --outdir dist --dry-run"),true);

// Production-mutating, unrelated, or shell-wrapped commands must remain rejected.
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy"),false);
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy --yes"),false);
assert.equal(isSafePreviewDeployCommand("npx wrangler versions deploy"),false);
assert.equal(isSafePreviewDeployCommand("echo wrangler deploy"),false);
assert.equal(isSafePreviewDeployCommand("echo wrangler deploy --dry-run"),false);
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy --dry-run && echo unsafe"),false);
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy --dry-run; echo unsafe"),false);
assert.equal(previewDeployCommandKind("npx wrangler deploy"),null);

console.log(JSON.stringify({
  ok:true,
  suite:"cloudflare-preview-command-policy",
  transition_mode:"recognize-legacy-prefer-dry-run",
  preferred_nonproduction_command:"npx wrangler deploy --dry-run",
  legacy_command_kind:"legacy-version-upload",
  preferred_command_kind:"dry-run",
  production_deploy_rejected:true,
  shell_wrappers_rejected:true
}));
