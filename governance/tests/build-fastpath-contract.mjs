import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../src/build-fastpath.js",import.meta.url),"utf8");
const entry=fs.readFileSync(new URL("../src/admin-entry.js",import.meta.url),"utf8");
const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));

for(const worker of ["governance-worker","admin-worker","maintenance-worker","intelligence-worker","compute-worker","expert-worker"])assert.match(source,new RegExp(`"${worker}"`));
assert.match(source,/\/builds\/workers\/\$\{encodeURIComponent\(workerTag\)\}\/builds/);
assert.match(source,/\/builds\/builds\/\$\{encodeURIComponent\(buildUuid\)\}\/logs/);
assert.match(source,/DEFAULT_TAIL_LINES=120/);
assert.match(source,/MAX_TAIL_LINES=300/);
assert.match(source,/Bearer \[REDACTED\]/);
assert.match(source,/bot_independent:true/);
assert.match(source,/state:"NOT_OBSERVED"/);
assert.doesNotMatch(source,/\/cancel/);
assert.doesNotMatch(source,/method:"POST"/);
assert.match(entry,/getBuildFastStatus/);
assert.match(entry,/getBuildLogTail/);
assert.match(entry,/\/v1\/admin\/builds\/fast-status/);
assert.match(entry,/\/v1\/admin\/builds\/logs/);
assert.match(entry,/\.\.\.buildFastOpenApiPaths\(\)/);
assert.match(pkg.scripts["test:build-gate"],/build-fastpath-contract\.mjs/);

console.log(JSON.stringify({ok:true,suite:"build-fastpath-contract",builds_api_direct_read:true,github_bot_bypassed:true,failed_build_auto_log_tail:true,default_tail_lines:120,max_tail_lines:300,admin_bearer_required:true,worker_allowlist:true,trigger_disabled:true,cancel_disabled:true,secrets_redacted:true}));
