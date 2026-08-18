import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const wrangler=JSON.parse(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
const adminPkg=JSON.parse(readFileSync(new URL("../../admin/package.json",import.meta.url),"utf8"));
const adminWrangler=JSON.parse(readFileSync(new URL("../../admin/wrangler.jsonc",import.meta.url),"utf8"));
const maintenancePkg=JSON.parse(readFileSync(new URL("../../maintenance/package.json",import.meta.url),"utf8"));
const maintenanceWrangler=JSON.parse(readFileSync(new URL("../../maintenance/wrangler.jsonc",import.meta.url),"utf8"));

assert.equal(pkg.scripts?.["cf:build"],"npm run test:build-gate");
assert.equal(pkg.scripts?.["cf:preview"],"npm run cf:build && npx wrangler deploy --dry-run");
assert.equal(pkg.scripts?.["cf:deploy"],"npm run cf:build && npx wrangler deploy");
assert.equal(pkg.devDependencies?.wrangler,"4.123.0");
assert.match(pkg.scripts?.["test:build-gate"]||"",/tests\/cloudflare-build-gate-contract\.mjs/);
assert.equal(wrangler.name,"governance-worker");
assert.equal(wrangler.workers_dev,true,"governance is the public governed gateway");
assert.equal(wrangler.preview_urls,false,"governance preview URLs must remain disabled");
assert.deepEqual(wrangler.secrets?.required,["ADMIN_GPT_TOKEN","CLOUDFLARE_BUILDS_API_TOKEN"]);
assert.match(wrangler.vars?.CLOUDFLARE_ACCOUNT_ID||"",/^[a-f0-9]{32}$/);
assert.equal(wrangler.build,undefined,"Workers Builds ignores Wrangler custom builds; the dashboard deploy command must invoke cf:build explicitly");
for(const [name,workerPkg,config] of [["admin",adminPkg,adminWrangler],["maintenance",maintenancePkg,maintenanceWrangler]]){
  assert.equal(workerPkg.scripts?.["cf:preview"],"npm run cf:build && npx wrangler deploy --dry-run",`${name} preview must be non-mutating`);
  assert.equal(workerPkg.devDependencies?.wrangler,"4.123.0",`${name} Wrangler must be pinned`);
  assert.equal(config.observability?.enabled,true,`${name} observability required`);
  assert.equal(config.preview_urls,false,`${name} preview URLs must remain disabled`);
}
assert.deepEqual(adminWrangler.secrets?.required,["ADMIN_GPT_TOKEN","CF_API_TOKEN"]);
assert.equal(maintenanceWrangler.workers_dev,false,"maintenance must be service-binding/cron only");

console.log(JSON.stringify({ok:true,suite:"cloudflare-build-gate-contract",worker:wrangler.name,preview_is_local_validation:true}));
