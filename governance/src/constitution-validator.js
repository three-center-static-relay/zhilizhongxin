export const SYSTEM_CONSTITUTION=Object.freeze({
  version:"1.1",
  path:"governance/SELF_EVOLVING_SYSTEM_CONSTITUTION.md",
  level:"highest-governance-constraint",
  immutable_principles:["mission","safety-boundary","governance-rules","auditability"],
  evolution_cycle:["discover","evaluate","experiment","benchmark","shadow","canary","promotion","long-term-evaluation"],
  self_approval_forbidden:true
});

const TYPES=new Set(["production-deploy","la-policy-change","maintenance-update","model-policy-change","runtime-route-refresh","architecture-upgrade","knowledge-method-upgrade"]);
const yes=v=>v===true;
const clean=v=>String(v??"").trim();

export function validateConstitutionalChange(input={}){
  const change_type=clean(input.change_type);
  const checks={
    known_change_type:TYPES.has(change_type),
    mission_preserved:yes(input.mission_preserved),
    safety_boundary_preserved:yes(input.safety_boundary_preserved),
    governance_rules_preserved:yes(input.governance_rules_preserved),
    auditability_preserved:yes(input.auditability_preserved),
    separation_of_duties_preserved:yes(input.separation_of_duties_preserved),
    deterministic_validation_passed:yes(input.deterministic_validation_passed),
    rollback_ready:yes(input.rollback_ready),
    self_approval_forbidden:input.self_approval!==true,
    independent_acceptance_required:yes(input.independent_acceptance_required)
  };
  const failed_checks=Object.entries(checks).filter(([,ok])=>ok!==true).map(([name])=>name);
  return{
    ok:failed_checks.length===0,
    verdict:failed_checks.length===0?"PASS":"DENY",
    constitution_version:SYSTEM_CONSTITUTION.version,
    constitution_path:SYSTEM_CONSTITUTION.path,
    change_type:change_type||null,
    checks,
    failed_checks,
    fail_closed:true,
    autonomous_execution_allowed:failed_checks.length===0,
    model_may_self_approve:false
  };
}

export function assertConstitutionalChange(input={}){
  const verdict=validateConstitutionalChange(input);
  if(!verdict.ok){
    const error=new Error("CONSTITUTION_GATE_DENIED");
    error.code="CONSTITUTION_GATE_DENIED";
    error.details=verdict;
    throw error;
  }
  return verdict;
}
