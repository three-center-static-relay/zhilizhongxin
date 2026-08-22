import {chooseMaintenanceBrain,chooseReviewer,repairExecutionPolicy} from "./maintenance-model-policy.js";
import {validateConstitutionalChange} from "./constitution-validator.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();

export function classifyIncident(receipt={}){
  const status=Number(receipt.http_status||receipt.status_code||0);
  const text=upper([receipt.error_code,receipt.error,receipt.message].filter(Boolean).join(" "));
  let error_class="UNKNOWN";
  if(text.includes("429")||status===429)error_class="RATE_LIMIT";
  else if(text.includes("TIMEOUT")||text.includes("DEADLINE")||text.includes("ABORT")||status===504)error_class="UPSTREAM_TIMEOUT";
  else if(status>=500||text.includes("UPSTREAM_UNAVAILABLE")||text.includes("UNAVAILABLE"))error_class="UPSTREAM_5XX";
  else if(text.includes("BUILD")||text.includes("SYNTAX"))error_class="BUILD_FAILURE";
  else if(text.includes("TEST")||text.includes("REGRESSION"))error_class="TEST_REGRESSION";
  else if(text.includes("SECURITY")||text.includes("POLICY_DENIED")||text.includes("PERMISSION"))error_class="SECURITY_GUARD";
  else if(receipt.code_defect===true)error_class="CODE_DEFECT";
  else if(receipt.ok===true)error_class="HEALTHY";
  const failure_count=Number(receipt.failure_count||0);
  if(failure_count>=3&&error_class!=="HEALTHY")error_class="REPEATED_FAILURE";
  return {error_class,status,stage:clean(receipt.stage)||"unknown",center:clean(receipt.center)||"unknown",provider:clean(receipt.provider)||null,model:clean(receipt.model)||null};
}

export function healthScore(metrics={}){
  const success=Math.max(0,Math.min(1,Number(metrics.success_rate??1)));
  const timeout=Math.max(0,Math.min(1,Number(metrics.timeout_rate??0)));
  const rate429=Math.max(0,Math.min(1,Number(metrics.rate_429??0)));
  const rate5xx=Math.max(0,Math.min(1,Number(metrics.rate_5xx??0)));
  const fallback=Math.max(0,Math.min(1,Number(metrics.fallback_rate??0)));
  const score=Math.round(100*Math.max(0,success-(timeout*.35+rate429*.25+rate5xx*.3+fallback*.1)));
  return {score,state:score>=85?"HEALTHY":score>=60?"DEGRADED":score>=30?"QUARANTINED":"FAILED"};
}

export function planAutonomicRepair(receipt={}){
  const incident=classifyIncident(receipt);
  const model=chooseMaintenanceBrain({...receipt,error_class:incident.error_class});
  const execution=repairExecutionPolicy({...receipt,error_class:incident.error_class});
  let action="DIAGNOSE";
  if(incident.error_class==="RATE_LIMIT")action="FALLBACK_AND_QUARANTINE";
  else if(incident.error_class==="UPSTREAM_TIMEOUT"||incident.error_class==="UPSTREAM_5XX")action="FALLBACK_THEN_HEALTH_RECHECK";
  else if(incident.error_class==="BUILD_FAILURE"||incident.error_class==="TEST_REGRESSION"||incident.error_class==="CODE_DEFECT")action=execution.codex_allowed?"CODE_REPAIR_AGENT":"MODEL_PATCH_THEN_TEST";
  else if(incident.error_class==="SECURITY_GUARD")action="FAIL_CLOSED_ESCALATE";
  else if(incident.error_class==="HEALTHY")action="NOOP";
  return {incident,model,reviewer:chooseReviewer(),execution,action,autonomous_paid_spend:false,production_mutation:false};
}

export function validateReleaseGate(input={}){
  const deterministic=Boolean(input.contract_tests_pass&&input.canary_pass&&input.security_pass&&input.receipts_valid);
  const budget=Number(input.paid_spend_usd||0);
  const allowedBudget=Number(input.max_paid_usd||0);
  const budgetOk=budget<=Math.max(0,allowedBudget);
  const rollbackReady=input.rollback_ready===true;
  const constitution=validateConstitutionalChange(input.constitution||{});
  return {
    ok:deterministic&&budgetOk&&rollbackReady&&constitution.ok,
    deterministic_tests:deterministic,
    budget_ok:budgetOk,
    rollback_ready:rollbackReady,
    constitution,
    constitution_gate_pass:constitution.ok,
    model_may_self_approve:false
  };
}
