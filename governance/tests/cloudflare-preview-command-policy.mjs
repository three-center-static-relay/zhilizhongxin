import assert from "node:assert/strict";
import {isSafePreviewDeployCommand} from "../src/cloudflare-builds.js";

// Transitional compatibility: existing preview triggers remain accepted until
// all Cloudflare projects are migrated to the non-mutating dry-run command.
assert.equal(isSafePreviewDeployCommand("npx wrangler versions upload"),true);
assert.equal(isSafePreviewDeployCommand("wrangler versions upload --strict"),true);

// Preferred command for Workers that declare Durable Object lifecycle via exports.
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy --dry-run"),true);
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy --dry-run --outdir dist"),true);
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy --outdir dist --dry-run"),true);

// Production-mutating or unrelated commands must remain rejected.
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy"),false);
assert.equal(isSafePreviewDeployCommand("npx wrangler deploy --yes"),false);
assert.equal(isSafePreviewDeployCommand("npx wrangler versions deploy"),false);
assert.equal(isSafePreviewDeployCommand("echo wrangler deploy"),false);

console.log(JSON.stringify({
  ok:true,
  suite:"cloudflare-preview-command-policy",
  transition_mode:"versions-upload-or-dry-run",
  preferred_nonproduction_command:"npx wrangler deploy --dry-run",
  production_deploy_rejected:true
}));
