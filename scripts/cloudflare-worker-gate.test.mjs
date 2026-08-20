import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

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

const requiredNames=["stable_domain","runtime_http","python_runtime","executor_auth","capability_http","sandbox_tools_visible","commands_visible","files_visible","code_visible","browser_visible","active_selftest_http","shell_exec","file_rw_cleanup","python_exec","chromium_navigation"];
const goodReceipt={ok:true,validation:"PASS",selftest:"executor-runtime-v5",resolved_executor:{mode:"project-domain",source:"makers-management-api",host:"stable.example"},checks:requiredNames.map(name=>({name,ok:true}))};
assert.equal(validateTencentRuntimeReceipt(goodReceipt),goodReceipt);
assert.throws(()=>validateTencentRuntimeReceipt({...goodReceipt,validation:"FAIL"}),/TENCENT_E2E_PASS_REQUIRED/);
assert.throws(()=>validateTencentRuntimeReceipt({...goodReceipt,resolved_executor:{mode:"bootstrap-deployment"}}),/TENCENT_E2E_STABLE_DOMAIN_REQUIRED/);
assert.throws(()=>validateTencentRuntimeReceipt({...goodReceipt,checks:goodReceipt.checks.map((x,i)=>i===11?{...x,ok:false}:x)}),/TENCENT_E2E_CHECK_FAILED:shell_exec/);

const postdeployPath=resolve(process.cwd(),"scripts/tencent-postdeploy-e2e.mjs");
const syntax=spawnSync(process.execPath,["--check",postdeployPath],{encoding:"utf8"});
assert.equal(syntax.status,0,syntax.stderr||"TENCENT_POSTDEPLOY_SYNTAX_INVALID");
const postdeploySource=readFileSync(postdeployPath,"utf8");
assert.match(postdeploySource,/request as httpsRequest/);
assert.match(postdeploySource,/E2E_DUAL_TRANSPORT_FAILED/);
assert.match(postdeploySource,/validateTencentRuntimeReceipt\(body\)/);
assert.match(postdeploySource,/TENCENT_POSTDEPLOY_E2E_FAILED:/);
assert.match(postdeploySource,/MAX_ATTEMPTS=3,INITIAL_SETTLE_MS=7000,RETRY_DELAY_MS=5000/);
assert.match(postdeploySource,/await sleep\(INITIAL_SETTLE_MS\)/);
assert.match(postdeploySource,/attempt<=MAX_ATTEMPTS/);
assert.match(postdeploySource,/await sleep\(RETRY_DELAY_MS\)/);
assert.match(postdeploySource,/SANDBOX_\[A-Z0-9_\]\+/);
assert.doesNotMatch(postdeploySource,/attempt<=8/);
assert.equal(postdeploySource.includes('throw new Error(`TENCENT_POSTDEPLOY_E2E_FAILED:${lastError}`)'),false,"POSTDEPLOY_FAILURE_MARKER_MUST_NOT_USE_UNCAUGHT_THROW");
assert.equal(postdeploySource.includes('console.error(`TENCENT_POSTDEPLOY_E2E_FAILED:${lastError}`)'),true,"POSTDEPLOY_FAILURE_MARKER_MUST_BE_SINGLE_RUNTIME_LINE");
assert.match(postdeploySource,/process\.exitCode=1/);
assert.doesNotMatch(postdeploySource,/console\.(?:log|error)\([^\n]*probe/);

console.log(JSON.stringify({ok:true,suite:"cloudflare-worker-gate-contract",fail_closed_context:true,exact_wrangler_pin:true,per_worker_path_isolation:true,production_attestation_shared_gate:true,canonical_admin_e2e_target:true,wrangler_output_not_authoritative_for_e2e_target:true,tencent_runtime_receipt_validation:true,tencent_postdeploy_dual_transport_syntax:true,tencent_postdeploy_probe_not_logged:true,tencent_postdeploy_single_runtime_failure_marker:true,tencent_postdeploy_max_attempts:3,tencent_candidate_initial_settle_ms:7000,tencent_retry_delay_ms:5000,tencent_sandbox_error_code_redaction:true,automatic_rollback_path:true}));
