import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const governance=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const maintenance=JSON.parse(readFileSync(new URL("../../maintenance/package.json",import.meta.url),"utf8"));
const versioned=readFileSync(new URL("../scripts/versioned-production-deploy.mjs",import.meta.url),"utf8");
const atomic=readFileSync(new URL("../scripts/atomic-production-deploy.mjs",import.meta.url),"utf8");
const wrangler=readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");

assert.equal(governance.scripts["cf:ci:deploy"],"node scripts/versioned-production-deploy.mjs");
assert.equal(governance.scripts["cf:ci:deploy:atomic"],"node scripts/atomic-production-deploy.mjs");
assert.match(versioned,/versions","upload/);
assert.match(versioned,/versions","deploy/);
assert.match(versioned,/@100%/);
assert.match(versioned,/GOVERNANCE_VERSIONED_PRODUCTION_ROLLBACK_COMPLETE/);
assert.match(versioned,/verify100/);
assert.match(atomic,/GOVERNANCE_ATOMIC_PRODUCTION_PASS/);
assert.match(wrangler,/"main":\s*"src\/admin-entry\.js"/);
assert.match(wrangler,/"ai":\s*\{"binding":\s*"AI"\}/);
assert.match(wrangler,/"MAINTENANCE_EXECUTION_OWNER":"maintenance-worker"/);
assert.match(wrangler,/"MAINTENANCE_PRIMARY_MODEL":"@cf\/nvidia\/nemotron-3-120b-a12b"/);
assert.doesNotMatch(wrangler,/"MAINTENANCE_CENTER"/);
assert.doesNotMatch(wrangler,/"AUTONOMIC_MAINTENANCE"/);
assert.doesNotMatch(wrangler,/"MAINTENANCE_QUEUE"/);
assert.equal(maintenance.scripts["cf:ci:deploy"],"node ../scripts/cloudflare-worker-gate.mjs maintenance deploy");
assert.equal(maintenance.scripts["cf:ci:expert-phase2"],"node scripts/runtime-expert-phase2-deploy-gate.mjs");
assert.notEqual(maintenance.scripts["cf:ci:deploy"],maintenance.scripts["cf:ci:expert-phase2"]);
console.log(JSON.stringify({ok:true,suite:"production-activation-gates",nemotron_primary:true,maintenance_execution_owner:"maintenance-worker",governance_stable_topology:true,one_way_monitoring:true,versioned_production_default:true,atomic_path_retained:true,rollback:true,expert_phase2_fail_closed_gate_retained:true}));
