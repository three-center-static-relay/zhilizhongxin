import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const governance=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const maintenance=JSON.parse(readFileSync(new URL("../../maintenance/package.json",import.meta.url),"utf8"));
const atomic=readFileSync(new URL("../scripts/atomic-production-deploy.mjs",import.meta.url),"utf8");
const wrangler=readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");

assert.equal(governance.scripts["cf:ci:deploy"],"node scripts/atomic-production-deploy.mjs");
assert.equal(governance.scripts["cf:ci:deploy:versioned"],"node scripts/versioned-production-deploy.mjs");
assert.match(atomic,/deploy","--config","wrangler\.jsonc","--dry-run/);
assert.match(atomic,/deploy","--config","wrangler\.jsonc/);
assert.match(atomic,/active_percentage_authority:"wrangler-deploy-success"/);
assert.match(atomic,/@cf\/nvidia\/nemotron-3-120b-a12b/);
assert.match(atomic,/maintenance_execution_owner:"maintenance-worker"/);
assert.match(atomic,/scheduled-health-monitor/);
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
console.log(JSON.stringify({ok:true,suite:"production-activation-gates",nemotron_primary:true,maintenance_execution_owner:"maintenance-worker",governance_stable_topology:true,one_way_monitoring:true,wrangler_deploy_is_activation_authority:true,versioned_path_retained:true,expert_phase2_fail_closed_gate_retained:true}));
