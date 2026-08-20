import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../src/build-fastpath.js",import.meta.url),"utf8");
const entry=fs.readFileSync(new URL("../src/admin-entry.js",import.meta.url),"utf8");
const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));

for(const worker of ["governance-worker","admin-worker","maintenance-worker"])assert.match(source,new RegExp(`"${worker}"`));
assert.match(source,/RECENT_BUILD_LIMIT=5/);
assert.match(source,/FAILURE_TAIL_LINES=120/);
assert.match(source,/MAX_LOG_PAGES=8/);
assert.match(source,/\/builds\/workers\/\$\{encodeURIComponent\(tag\)\}\/builds/);
assert.match(source,/\/builds\/builds\/\$\{encodeURIComponent\(buildUuid\)\}\/logs/);
assert.match(source,/"fail","failed","failure"/);
assert.match(source,/outcome==="terminated"/);
assert.match(source,/payload\.lines\?\?/);
assert.match(source,/cursor=String\(payload\?\.cursor/);
assert.match(source,/bot_independent:true/);
assert.match(source,/latest_failure_logs/);
assert.match(source,/Bearer \[REDACTED\]/);
assert.match(source,/export async function collectBuildFastStatus/);
assert.match(source,/export async function enrichSystemHealthWithBuilds/);
assert.match(source,/crypto\.subtle\.digest\("SHA-256"/);
assert.match(source,/delete base\.receipt_digest/);
assert.match(source,/receipt_digest=await sha256Text\(JSON\.stringify\(base\)\)/);
assert.doesNotMatch(source,/\/cancel/);
assert.doesNotMatch(source,/method:"POST"/);

assert.match(entry,/import \{enrichSystemHealthWithBuilds\} from "\.\/build-fastpath\.js"/);
assert.match(entry,/\/v1\/admin\/health/);
assert.match(entry,/enrichSystemHealthWithBuilds\(await getSystemHealth\(request,env,ctx,app\),env\)/);
assert.doesNotMatch(entry,/\/v1\/admin\/builds\//);
assert.doesNotMatch(entry,/buildFastOpenApiPaths/);
assert.match(entry,/paths:\{\.\.\.\(spec\.paths\|\|\{\}\),\.\.\.adminOpenApiPaths\(\)\}/);
assert.match(pkg.scripts["test:build-gate"],/build-fastpath-contract\.mjs/);

console.log(JSON.stringify({ok:true,suite:"build-fastpath-contract",health_enrichment:true,action_schema_unchanged:true,receipt_digest_covers_build_status:true,builds_api_direct_read:true,github_bot_bypassed:true,recent_build_limit:5,failed_build_auto_log_tail:true,cursor_aware_logs:true,default_failure_tail_lines:120,admin_bearer_inherited:true,trigger_disabled:true,cancel_disabled:true,secrets_redacted:true}));
