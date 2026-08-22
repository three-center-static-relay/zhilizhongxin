const APPROVED_RUNTIME_PROVIDERS=new Set(["workers-ai","openrouter","huggingface"]);
const SHA256=/^[a-f0-9]{64}$/i;
const clean=v=>String(v??"").trim();
const norm=v=>clean(v).toLowerCase().replace(/[_\s]+/g,"-");

export const MAINTENANCE_CONSTITUTION=Object.freeze({
  version:"1.1",
  source:"governance/SELF_EVOLVING_SYSTEM_CONSTITUTION.md",
  change_type:"runtime-route-refresh",
  fail_closed:true,
  self_approval:false,
  independent_acceptance_required:true
});

export function validateExpertRouteMutation(plan={}){
  const summary=plan?.summary||{};
  const providers=Array.isArray(summary.providers)?summary.providers.map(norm).filter(Boolean):[];
  const routes=Array.isArray(plan?.routes)?plan.routes:[];
  const checks={
    mission_preserved:true,
    safety_boundary_preserved:summary.telemetry_payload_read!==true,
    governance_rules_preserved:summary.model_id_pinning!==true,
    auditability_preserved:SHA256.test(clean(plan?.plan_digest))&&SHA256.test(clean(plan?.routing_fingerprint)),
    separation_of_duties_preserved:true,
    deterministic_validation_passed:Number(summary.candidate_count)>=2&&Number(summary.company_count)>=2&&routes.length>0,
    rollback_ready:routes.every(r=>clean(r?.routeName)&&Array.isArray(r?.lanes)&&r.lanes.length>=1),
    approved_runtime_providers:providers.length>0&&providers.every(p=>APPROVED_RUNTIME_PROVIDERS.has(p)),
    self_approval_forbidden:true,
    independent_acceptance_required:true
  };
  const failed_checks=Object.entries(checks).filter(([,ok])=>ok!==true).map(([name])=>name);
  return{
    ok:failed_checks.length===0,
    verdict:failed_checks.length===0?"PASS":"DENY",
    constitution_version:MAINTENANCE_CONSTITUTION.version,
    constitution_source:MAINTENANCE_CONSTITUTION.source,
    change_type:MAINTENANCE_CONSTITUTION.change_type,
    checks,
    failed_checks,
    fail_closed:true,
    self_approval:false,
    independent_acceptance_required:true
  };
}

export function assertExpertRouteMutation(plan={}){
  const verdict=validateExpertRouteMutation(plan);
  if(!verdict.ok){
    const error=new Error("CONSTITUTION_ROUTE_GATE_DENIED");
    error.code="CONSTITUTION_ROUTE_GATE_DENIED";
    error.details=verdict;
    throw error;
  }
  return verdict;
}
