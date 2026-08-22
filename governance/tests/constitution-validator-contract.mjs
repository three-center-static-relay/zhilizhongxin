import assert from "node:assert/strict";
import {SYSTEM_CONSTITUTION,validateConstitutionalChange,assertConstitutionalChange} from "../src/constitution-validator.js";
import {validateReleaseGate} from "../src/autonomic-maintenance.js";

const good={
  change_type:"production-deploy",
  mission_preserved:true,
  safety_boundary_preserved:true,
  governance_rules_preserved:true,
  auditability_preserved:true,
  separation_of_duties_preserved:true,
  deterministic_validation_passed:true,
  rollback_ready:true,
  self_approval:false,
  independent_acceptance_required:true
};

assert.equal(SYSTEM_CONSTITUTION.version,"1.1");
assert.equal(SYSTEM_CONSTITUTION.path,"governance/SELF_EVOLVING_SYSTEM_CONSTITUTION.md");
assert.equal(validateConstitutionalChange(good).ok,true);
assert.equal(assertConstitutionalChange(good).verdict,"PASS");
assert.equal(validateConstitutionalChange({...good,mission_preserved:false}).ok,false);
assert.equal(validateConstitutionalChange({...good,self_approval:true}).ok,false);
assert.equal(validateConstitutionalChange({...good,change_type:"unknown"}).ok,false);
assert.throws(()=>assertConstitutionalChange({...good,rollback_ready:false}),/CONSTITUTION_GATE_DENIED/);

const release=validateReleaseGate({
  contract_tests_pass:true,
  canary_pass:true,
  security_pass:true,
  receipts_valid:true,
  rollback_ready:true,
  paid_spend_usd:0,
  max_paid_usd:0,
  constitution:good
});
assert.equal(release.ok,true);
assert.equal(release.constitution_gate_pass,true);
assert.equal(validateReleaseGate({contract_tests_pass:true,canary_pass:true,security_pass:true,receipts_valid:true,rollback_ready:true,constitution:{}}).ok,false);
assert.equal(validateReleaseGate({contract_tests_pass:true,canary_pass:true,security_pass:true,receipts_valid:true,rollback_ready:true,constitution:{...good,self_approval:true}}).ok,false);

console.log("constitution-validator-contract: PASS");
