import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const governance=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const maintenance=JSON.parse(readFileSync(new URL("../../maintenance/package.json",import.meta.url),"utf8"));
const atomic=readFileSync(new URL("../scripts/atomic-production-deploy.mjs",import.meta.url),"utf8");

assert.equal(governance.scripts["cf:ci:deploy"],"node scripts/atomic-production-deploy.mjs");
assert.equal(governance.scripts["cf:ci:deploy:versioned"],"node scripts/versioned-production-deploy.mjs");
assert.match(atomic,/three-center-maintenance/);
assert.match(atomic,/three-center-maintenance-dlq/);
assert.match(atomic,/queues","info/);
assert.match(atomic,/queues","create/);
assert.match(atomic,/deploy","--config","wrangler\.jsonc/);
assert.match(atomic,/--x-provision/);
assert.match(atomic,/--x-auto-create/);
assert.match(atomic,/active_percentage_authority:"wrangler-deploy-success"/);
assert.doesNotMatch(atomic,/deployments","status/);
assert.match(atomic,/GOVERNANCE_ATOMIC_PRODUCTION_PASS/);
assert.equal(maintenance.scripts["cf:ci:deploy"],"node ../scripts/cloudflare-worker-gate.mjs maintenance deploy");
assert.equal(maintenance.scripts["cf:ci:expert-phase2"],"node scripts/runtime-expert-phase2-deploy-gate.mjs");
assert.notEqual(maintenance.scripts["cf:ci:deploy"],maintenance.scripts["cf:ci:expert-phase2"]);
console.log(JSON.stringify({ok:true,suite:"production-activation-gates",governance_resource_bootstrap:true,wrangler_deploy_is_activation_authority:true,governance_atomic_binding_activation:true,versioned_path_retained:true,maintenance_infrastructure_independent:true,expert_phase2_fail_closed_gate_retained:true}));
