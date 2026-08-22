const CF_ROUTINE_MODEL="@cf/zai-org/glm-4.7-flash";
const CF_DEEP_MODEL="@cf/nvidia/nemotron-3-120b-a12b";
const CF_REVIEW_MODEL="@cf/google/gemma-4-26b-a4b-it";
const APPROVED_SOURCES=Object.freeze(["workers-ai","openrouter","huggingface"]);

const COMPLEX_CLASSES=new Set(["UNKNOWN","CROSS_CENTER","CODE_DEFECT","REGRESSION","SECURITY_GUARD","REPEATED_FAILURE"]);
const CODE_CLASSES=new Set(["CODE_DEFECT","REGRESSION","BUILD_FAILURE","TEST_REGRESSION"]);
const clean=v=>String(v??"").trim();
const norm=v=>clean(v).toLowerCase().replace(/[_\s]+/g,"-");

export const MAINTENANCE_MODEL_POLICY=Object.freeze({
  strategy:"three-source-free-first-dynamic-health-routing",
  approved_sources:APPROVED_SOURCES,
  discovery_authority:"leaderboards-discovery-only-not-runtime-authority",
  routine_model:CF_ROUTINE_MODEL,
  deep_model:CF_DEEP_MODEL,
  review_model:CF_REVIEW_MODEL,
  openrouter_role:"secondary-dynamic-pool",
  huggingface_role:"secondary-open-model-pool",
  workers_ai_role:"primary-free-native-pool",
  paid_budget_default_usd:0,
  automatic_paid_fallback:false,
  codex_role:"optional-code-repair-harness-not-model-source",
  codex_default_enabled:false,
  final_pass_authority:"deterministic-validator",
  tools_for_reasoning_models:false,
  web_for_reasoning_models:false
});

export function isApprovedModelSource(source){return APPROVED_SOURCES.includes(norm(source))}

export function assertApprovedModelSource(source){
  const normalized=norm(source);
  if(!isApprovedModelSource(normalized))throw new Error(`MODEL_SOURCE_NOT_APPROVED:${normalized||"missing"}`);
  return normalized;
}

export function chooseMaintenanceBrain(input={}){
  const errorClass=clean(input.error_class).toUpperCase()||"UNKNOWN";
  const complexity=clean(input.complexity).toLowerCase();
  const repeated=Number(input.failure_count||0)>=2;
  const crossCenter=Number(input.affected_centers||0)>=2;
  const deep=complexity==="deep"||repeated||crossCenter||COMPLEX_CLASSES.has(errorClass);
  return {role:deep?"deep":"routine",provider:"workers-ai",model:deep?CF_DEEP_MODEL:CF_ROUTINE_MODEL,free_first:true};
}

export function chooseReviewer(){
  return {role:"independent-review",provider:"workers-ai",model:CF_REVIEW_MODEL,free_first:true,independent_company:true};
}

export function repairExecutionPolicy(input={}){
  const errorClass=clean(input.error_class).toUpperCase();
  const paidBudget=Number(input.max_paid_usd??0);
  return {
    runtime_repair_first:true,
    config_repair_second:true,
    code_repair:CODE_CLASSES.has(errorClass),
    codex_allowed:CODE_CLASSES.has(errorClass)&&input.simple_patch_failed===true,
    openrouter_allowed:input.openrouter_free_candidate===true||paidBudget>0,
    huggingface_allowed:input.huggingface_free_candidate===true,
    paid_fallback_allowed:paidBudget>0,
    max_paid_usd:Number.isFinite(paidBudget)&&paidBudget>0?paidBudget:0,
    fixed_model_pin:false,
    approved_sources:APPROVED_SOURCES
  };
}

export function leaderboardCandidatePolicy(candidate={}){
  const source=norm(candidate.source||candidate.provider);
  return {
    eligible:Boolean(clean(candidate.model))&&isApprovedModelSource(source)&&candidate.health_pass===true&&candidate.contract_pass===true&&candidate.free_or_budget_ok===true,
    source:"discovery-only",
    approved_source:isApprovedModelSource(source),
    requires_canary:true,
    requires_health_registry:true,
    direct_production_selection:false
  };
}
