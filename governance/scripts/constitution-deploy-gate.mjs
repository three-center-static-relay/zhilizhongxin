import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {assertConstitutionalChange} from "../src/constitution-validator.js";

function constitutionDocumentChecks(){
  const doc=readFileSync(resolve(process.cwd(),"SELF_EVOLVING_SYSTEM_CONSTITUTION.md"),"utf8");
  return{
    mission_preserved:doc.includes("能力可以进化，使命不可漂移"),
    safety_boundary_preserved:doc.includes("安全边界"),
    governance_rules_preserved:doc.includes("治理规则"),
    auditability_preserved:doc.includes("审计要求"),
    separation_of_duties_preserved:doc.includes("提出修改 + 执行修改 + 自我证明正确")
  };
}

export function assertDeployConstitution({change_type="production-deploy",deterministic_validation_passed=false,rollback_ready=false}={}){
  const document=constitutionDocumentChecks();
  return assertConstitutionalChange({
    change_type,
    ...document,
    deterministic_validation_passed:deterministic_validation_passed===true,
    rollback_ready:rollback_ready===true,
    self_approval:false,
    independent_acceptance_required:true
  });
}
