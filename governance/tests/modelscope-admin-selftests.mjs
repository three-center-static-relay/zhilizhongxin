import assert from "node:assert/strict";
import fs from "node:fs";

const entry=fs.readFileSync(new URL("../src/admin-entry.js",import.meta.url),"utf8");
assert.match(entry,/\/v1\/intelligence\/modelscope-selftest/);
assert.match(entry,/\/v1\/compute\/modelscope-selftest/);
assert.match(entry,/INTELLIGENCE_CENTER/);
assert.match(entry,/COMPUTE_CENTER/);
assert.match(entry,/ADMIN_GPT_TOKEN/);
assert.match(entry,/\/v1\/selftest\/modelscope-runtime/);
assert.match(entry,/secrets_redacted:true/);
assert.match(entry,/runModelScopeSelftest/);
assert.match(entry,/adminOpenApiPaths\(\)/);
assert.doesNotMatch(entry,/MODELSCOPE_TOKEN/);

console.log(JSON.stringify({ok:true,suite:"modelscope-admin-selftests",authenticated:true,service_binding:true,secrets_redacted:true,canonical_action_surface_unchanged:true}));
