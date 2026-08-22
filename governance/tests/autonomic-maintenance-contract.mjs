import assert from "node:assert/strict";
import {MAINTENANCE_MODEL_POLICY,isApprovedModelSource,assertApprovedModelSource,chooseMaintenanceBrain,chooseReviewer,repairExecutionPolicy,leaderboardCandidatePolicy} from "../src/maintenance-model-policy.js";
import {classifyIncident,healthScore,planAutonomicRepair,validateReleaseGate} from "../src/autonomic-maintenance.js";

assert.deepEqual(MAINTENANCE_MODEL_POLICY.approved_sources,["workers-ai","openrouter","huggingface"]);
assert.equal(MAINTENANCE_MODEL_POLICY.strategy,"nemotron-primary-three-source-free-first-fallback");
assert.equal(MAINTENANCE_MODEL_POLICY.discovery_authority,"leaderboards-discovery-only-not-runtime-authority");
assert.equal(MAINTENANCE_MODEL_POLICY.automatic_paid_fallback,false);
assert.equal(MAINTENANCE_MODEL_POLICY.paid_budget_default_usd,0);
assert.equal(MAINTENANCE_MODEL_POLICY.primary_model,"@cf/nvidia/nemotron-3-120b-a12b");
assert.equal(MAINTENANCE_MODEL_POLICY.routine_model,"@cf/nvidia/nemotron-3-120b-a12b");
assert.equal(MAINTENANCE_MODEL_POLICY.deep_model,"@cf/nvidia/nemotron-3-120b-a12b");
assert.equal(MAINTENANCE_MODEL_POLICY.review_model,"@cf/google/gemma-4-26b-a4b-it");
assert.equal(isApprovedModelSource("workers-ai"),true);
assert.equal(isApprovedModelSource("openrouter"),true);
assert.equal(isApprovedModelSource("huggingface"),true);
assert.equal(isApprovedModelSource("deepseek"),false);
assert.throws(()=>assertApprovedModelSource("deepseek"),/MODEL_SOURCE_NOT_APPROVED/);
assert.equal(chooseMaintenanceBrain({error_class:"RATE_LIMIT"}).model,"@cf/nvidia/nemotron-3-120b-a12b");
assert.equal(chooseMaintenanceBrain({error_class:"CODE_DEFECT"}).model,"@cf/nvidia/nemotron-3-120b-a12b");
assert.notEqual(chooseMaintenanceBrain({error_class:"RATE_LIMIT"}).model,chooseReviewer().model);
assert.equal(chooseMaintenanceBrain({error_class:"CODE_DEFECT"}).role,"deep");
assert.equal(repairExecutionPolicy({error_class:"CODE_DEFECT",simple_patch_failed:false,max_paid_usd:0}).codex_allowed,false);
assert.equal(repairExecutionPolicy({error_class:"CODE_DEFECT",simple_patch_failed:true,max_paid_usd:0}).codex_allowed,true);
assert.equal(repairExecutionPolicy({error_class:"RATE_LIMIT",max_paid_usd:0}).paid_fallback_allowed,false);
assert.equal(repairExecutionPolicy({error_class:"RATE_LIMIT",max_paid_usd:0}).primary_model,"@cf/nvidia/nemotron-3-120b-a12b");
assert.equal(leaderboardCandidatePolicy({source:"deepseek",model:"candidate",health_pass:true,contract_pass:true,free_or_budget_ok:true}).eligible,false);
assert.equal(leaderboardCandidatePolicy({source:"openrouter",model:"candidate",health_pass:true,contract_pass:true,free_or_budget_ok:true}).direct_production_selection,false);

assert.equal(classifyIncident({status_code:429}).error_class,"RATE_LIMIT");
assert.equal(classifyIncident({http_status:504}).error_class,"UPSTREAM_TIMEOUT");
assert.equal(classifyIncident({error:"build failed"}).error_class,"BUILD_FAILURE");
assert.equal(healthScore({success_rate:1,timeout_rate:0,rate_429:0,rate_5xx:0,fallback_rate:0}).state,"HEALTHY");
assert.equal(planAutonomicRepair({status_code:429,max_paid_usd:0}).action,"FALLBACK_AND_QUARANTINE");
assert.equal(planAutonomicRepair({code_defect:true,simple_patch_failed:true,max_paid_usd:0}).action,"CODE_REPAIR_AGENT");

const constitution={change_type:"maintenance-update",mission_preserved:true,safety_boundary_preserved:true,governance_rules_preserved:true,auditability_preserved:true,separation_of_duties_preserved:true,deterministic_validation_passed:true,rollback_ready:true,self_approval:false,independent_acceptance_required:true};
assert.equal(validateReleaseGate({contract_tests_pass:true,canary_pass:true,security_pass:true,receipts_valid:true,rollback_ready:true,paid_spend_usd:0,max_paid_usd:0,constitution}).ok,true);
assert.equal(validateReleaseGate({contract_tests_pass:true,canary_pass:true,security_pass:true,receipts_valid:true,rollback_ready:false,paid_spend_usd:0,max_paid_usd:0,constitution:{...constitution,rollback_ready:false}}).ok,false);
assert.equal(validateReleaseGate({contract_tests_pass:true,canary_pass:true,security_pass:true,receipts_valid:true,rollback_ready:true,paid_spend_usd:0.01,max_paid_usd:0,constitution}).ok,false);
assert.equal(validateReleaseGate({contract_tests_pass:true,canary_pass:true,security_pass:true,receipts_valid:true,rollback_ready:true,constitution}).model_may_self_approve,false);
assert.equal(validateReleaseGate({contract_tests_pass:true,canary_pass:true,security_pass:true,receipts_valid:true,rollback_ready:true}).ok,false);

console.log("autonomic-maintenance-contract: PASS");
