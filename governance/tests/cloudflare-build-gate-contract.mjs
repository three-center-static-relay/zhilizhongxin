import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const wrangler=JSON.parse(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));

assert.equal(pkg.scripts?.["cf:build"],"npm run test:build-gate");
assert.equal(pkg.scripts?.["cf:preview"],"npm run cf:build && npx wrangler versions upload");
assert.equal(pkg.scripts?.["cf:deploy"],"npm run cf:build && npx wrangler deploy");
assert.match(pkg.scripts?.["test:build-gate"]||"",/tests\/cloudflare-build-gate-contract\.mjs/);
assert.equal(wrangler.name,"governance-worker");
assert.equal(wrangler.build,undefined,"Workers Builds ignores Wrangler custom builds; the dashboard deploy command must invoke cf:build explicitly");

console.log(JSON.stringify({ok:true,suite:"cloudflare-build-gate-contract",worker:wrangler.name,preview_promotes_production:false}));
