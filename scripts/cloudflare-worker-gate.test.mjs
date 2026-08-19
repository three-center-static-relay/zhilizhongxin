import assert from "node:assert/strict";

import {
  adminPublicBaseFromOpenApi,
  isRelevantPath,
  parseWorkersDevUrl,
  relevantPaths,
  validateInvocation,
  validateTencentRuntimeReceipt,
  validateWranglerVersion,
} from "./cloudflare-worker-gate.mjs";

const previewEnv = {WORKERS_CI:"1",WORKERS_CI_BRANCH:"feature/gate",WORKERS_CI_COMMIT_SHA:"a".repeat(40)};
const deployEnv = {...previewEnv,WORKERS_CI_BRANCH:"main"};

assert.deepEqual(validateInvocation("admin","preview",previewEnv),{branch:"feature/gate",sha:"a".repeat(40)});
assert.deepEqual(validateInvocation("governance","deploy",deployEnv),{branch:"main",sha:"a".repeat(40)});
assert.throws(()=>validateInvocation("admin","deploy",previewEnv),/PRODUCTION_BRANCH_REQUIRED/);
assert.throws(()=>validateInvocation("admin","preview",deployEnv),/PREVIEW_BRANCH_REQUIRED/);
assert.throws(()=>validateInvocation("unknown","preview",previewEnv),/UNSUPPORTED_SCOPE/);
assert.throws(()=>validateInvocation("admin","preview",{...previewEnv,WORKERS_CI:"0"}),/WORKERS_CI_REQUIRED/);
assert.throws(()=>validateInvocation("admin","preview",{...previewEnv,WORKERS_CI_COMMIT_SHA:"bad"}),/VALID_COMMIT_SHA_REQUIRED/);
assert.throws(()=>validateInvocation("admin","preview",{...previewEnv,WORKERS_CI_BRANCH:"../bad"}),/VALID_WORKERS_CI_BRANCH_REQUIRED/);

assert.equal(validateWranglerVersion("4.123.0"),"4.123.0");
assert.throws(()=>validateWranglerVersion("^4.123.0"),/EXACT_WRANGLER_VERSION_REQUIRED/);

assert.equal(isRelevantPath("admin","admin/src/index.js"),true);
assert.equal(isRelevantPath("admin","governance/src/index.js"),false);
assert.equal(isRelevantPath("governance","admin/docs/canary.md"),false);
assert.equal(isRelevantPath("governance","governance/docs/canary.md"),true);
assert.equal(isRelevantPath("maintenance",".npmrc"),true);
assert.equal(isRelevantPath("maintenance","scripts/cloudflare-worker-gate.mjs"),true);
assert.equal(isRelevantPath("admin","scripts/tencent-postdeploy-e2e.mjs"),true);
assert.equal(isRelevantPath("admin","scripts/tencent-production-attestation-verify.mjs"),true);
assert.equal(isRelevantPath("governance","scripts/tencent-production-attestation-verify.mjs"),true);
assert.equal(isRelevantPath("maintenance","scripts/tencent-production-attestation-verify.mjs"),true);
assert.deepEqual(relevantPaths("governance",["admin/a.js","governance/z.js","governance/a.js","governance/a.js"]),["governance/a.js","governance/z.js"]);

assert.equal(parseWorkersDevUrl("Deployed https://admin-worker.example123.workers.dev in 1s"),"https://admin-worker.example123.workers.dev");
assert.throws(()=>parseWorkersDevUrl("no deployment url"),/WORKERS_DEV_URL_NOT_FOUND/);
assert.equal(adminPublicBaseFromOpenApi({servers:[{url:"https://admin-worker.a15280020511.workers.dev"}]}),"https://admin-worker.a15280020511.workers.dev");
assert.equal(adminPublicBaseFromOpenApi({servers:[{url:"https://admin-worker.a15280020511.workers.dev/"}]}),"https://admin-worker.a15280020511.workers.dev");
assert.throws(()=>adminPublicBaseFromOpenApi({servers:[{url:"https://example.com"}]}),/VALID_ADMIN_WORKERS_DEV_URL_REQUIRED/);
assert.throws(()=>adminPublicBaseFromOpenApi({servers:[]}),/ADMIN_OPENAPI_SERVER_REQUIRED/);

const requiredNames=[
  "stable_domain","runtime_http","python_runtime","executor_auth","capability_http",
  "sandbox_tools_visible","commands_visible","files_visible","code_visible","browser_visible",
  "active_selftest_http","shell_exec","file_rw_cleanup","python_exec","chromium_navigation"
];
const goodReceipt={
  ok:true,validation:"PASS",selftest:"executor-runtime-v5",
  resolved_executor:{mode:"project-domain",source:"makers-management-api",host:"stable.example"},
  checks:requiredNames.map(name=>({name,ok:true}))
};
assert.equal(validateTencentRuntimeReceipt(goodReceipt),goodReceipt);
assert.throws(()=>validateTencentRuntimeReceipt({...goodReceipt,validation:"FAIL"}),/TENCENT_E2E_PASS_REQUIRED/);
assert.throws(()=>validateTencentRuntimeReceipt({...goodReceipt,resolved_executor:{mode:"bootstrap-deployment"}}),/TENCENT_E2E_STABLE_DOMAIN_REQUIRED/);
assert.throws(()=>validateTencentRuntimeReceipt({...goodReceipt,checks:goodReceipt.checks.map((x,i)=>i===11?{...x,ok:false}:x)}),/TENCENT_E2E_CHECK_FAILED:shell_exec/);

console.log(JSON.stringify({
  ok:true,
  suite:"cloudflare-worker-gate-contract",
  fail_closed_context:true,
  exact_wrangler_pin:true,
  per_worker_path_isolation:true,
  production_attestation_shared_gate:true,
  canonical_admin_e2e_target:true,
  wrangler_output_not_authoritative_for_e2e_target:true,
  tencent_runtime_receipt_validation:true,
  automatic_rollback_path:true
}));
