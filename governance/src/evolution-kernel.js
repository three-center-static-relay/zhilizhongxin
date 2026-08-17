import {TRUST_LEVELS,sha256Json,validateManifest} from "./capability-abi.js";
import {governanceCapabilityManifest} from "./governance-capability-manifest.js";

export const EVOLUTION_KERNEL_VERSION="open-adaptive-kernel-v1-20260818";
export const L0_CONSTITUTION=Object.freeze({
  version:"l0-constitution-v1-20260818",
  invariants:[
    "legal_compliance","authorization_boundary","secret_non_disclosure","user_authorization_priority","budget_enforcement",
    "evidence_non_fabrication","traceability","auditability","controlled_high_risk_side_effects","new_capability_untrusted_by_default",
    "autonomous_change_reversible"
  ],
  production_mutation_requires:["evolution_contract","static_check","simulation","shadow","canary","benchmark","explicit_promotion_gate","rollback_target"],
  fail_closed:true
});

const TASK_FIELDS=Object.freeze(["task_id","goal","constraints","risk","budget","required_capabilities","deadline","success_criteria"]);
const EVOLUTION_FIELDS=Object.freeze(["candidate_id","parent_id","reason","hypothesis","affected_components","expected_gain","complexity_delta","risk_delta","benchmark","rollback_target"]);
const CENTER_BINDINGS=Object.freeze([
  ["intelligence","INTELLIGENCE_CENTER","https://intelligence.internal/v1/capabilities"],
  ["compute","COMPUTE_CENTER","https://compute.internal/v1/capabilities"],
  ["expert","EXPERT_CENTER","https://expert.internal/v1/capabilities"]
]);
const MAX_MANIFEST_BYTES=262144;

const plain=value=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const words=value=>new Set(String(value||"").toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>1));
const overlap=(left,right)=>{let n=0;for(const item of left)if(right.has(item))n++;return n};
const trustRank=level=>Math.max(0,TRUST_LEVELS.indexOf(level));

export function kernelSnapshot(){
  return {
    ok:true,kernel_version:EVOLUTION_KERNEL_VERSION,constitution:L0_CONSTITUTION,
    stable_organs:["governance","intelligence","compute","expert"],
    immutable_protocols:["capability-abi-v1","task-envelope-v1","evidence-envelope-v1","receipt-envelope-v1","evolution-contract-v1"],
    phase_status:{phase_0:"implemented",phase_1:"implemented-foundation",phase_2:"implemented-deterministic-graph",phase_3:"not_enabled",phase_4:"not_enabled",phase_5:"not_enabled",phase_6:"observe-only",phase_7:"not_enabled",phase_8:"not_enabled"},
    langgraph:{role:"dynamic-neural-system",adapter_status:"quarantined-until-foundation-canary",current_runtime:"deterministic-capability-graph"},
    autonomous_production_mutation:false,production_write:false,rollback_required:true
  };
}

export function validateTaskEnvelope(task){
  const errors=[];
  if(!plain(task))return{ok:false,errors:["TASK_NOT_OBJECT"]};
  for(const field of TASK_FIELDS)if(!(field in task))errors.push(`MISSING_${field.toUpperCase()}`);
  for(const field of Object.keys(task))if(!TASK_FIELDS.includes(field))errors.push(`UNKNOWN_${field.toUpperCase()}`);
  if(!/^[A-Za-z0-9._:-]{1,160}$/.test(String(task.task_id||"")))errors.push("INVALID_TASK_ID");
  if(typeof task.goal!=="string"||!task.goal.trim()||task.goal.length>4000)errors.push("INVALID_GOAL");
  if(!plain(task.constraints))errors.push("INVALID_CONSTRAINTS");
  if(!plain(task.budget))errors.push("INVALID_BUDGET");
  if(!plain(task.risk))errors.push("INVALID_RISK");
  if(!Array.isArray(task.required_capabilities)||task.required_capabilities.length===0||task.required_capabilities.length>24)errors.push("INVALID_REQUIRED_CAPABILITIES");
  else if(task.required_capabilities.some(x=>typeof x!=="string"||!/^[a-z0-9][a-z0-9._:-]{1,159}$/.test(x)))errors.push("INVALID_REQUIRED_CAPABILITY");
  if(!Array.isArray(task.success_criteria)||task.success_criteria.length===0||task.success_criteria.length>24||task.success_criteria.some(x=>typeof x!=="string"||!x.trim()))errors.push("INVALID_SUCCESS_CRITERIA");
  if(!task.deadline||Number.isNaN(Date.parse(task.deadline)))errors.push("INVALID_DEADLINE");
  return{ok:errors.length===0,errors};
}

export function validateEvolutionContract(candidate){
  const errors=[];
  if(!plain(candidate))return{ok:false,errors:["CANDIDATE_NOT_OBJECT"],promotion_eligible:false};
  for(const field of EVOLUTION_FIELDS)if(!(field in candidate))errors.push(`MISSING_${field.toUpperCase()}`);
  for(const field of ["candidate_id","parent_id","reason","hypothesis","rollback_target"])if(typeof candidate[field]!=="string"||!candidate[field].trim())errors.push(`INVALID_${field.toUpperCase()}`);
  if(!Array.isArray(candidate.affected_components)||candidate.affected_components.length===0)errors.push("INVALID_AFFECTED_COMPONENTS");
  if(!plain(candidate.expected_gain))errors.push("INVALID_EXPECTED_GAIN");
  if(!Number.isFinite(Number(candidate.complexity_delta)))errors.push("INVALID_COMPLEXITY_DELTA");
  if(!Number.isFinite(Number(candidate.risk_delta)))errors.push("INVALID_RISK_DELTA");
  if(!plain(candidate.benchmark))errors.push("INVALID_BENCHMARK");
  else{
    if(!plain(candidate.benchmark.static_check))errors.push("STATIC_CHECK_REQUIRED");
    if(!plain(candidate.benchmark.simulation))errors.push("SIMULATION_REQUIRED");
    if(!plain(candidate.benchmark.shadow))errors.push("SHADOW_REQUIRED");
    if(!plain(candidate.benchmark.canary))errors.push("CANARY_REQUIRED");
  }
  if(candidate.production_mutation===true)errors.push("DIRECT_PRODUCTION_MUTATION_FORBIDDEN");
  return{ok:errors.length===0,errors,promotion_eligible:false,next_stage:errors.length?"repair":"quarantine",production_mutation:false};
}

async function boundedJson(response){
  const declared=Number(response.headers.get("content-length")||0);
  if(declared>MAX_MANIFEST_BYTES)throw new Error("MANIFEST_TOO_LARGE");
  const raw=await response.text();
  if(new TextEncoder().encode(raw).length>MAX_MANIFEST_BYTES)throw new Error("MANIFEST_TOO_LARGE");
  try{return raw?JSON.parse(raw):null}catch{throw new Error("MANIFEST_BAD_JSON")}
}

async function fetchCenterManifest(center,binding,url){
  if(!binding?.fetch)return{center,ok:false,error:"CENTER_BINDING_UNAVAILABLE"};
  try{
    const response=await binding.fetch(new Request(url,{method:"GET",headers:{accept:"application/json"}}));
    const body=await boundedJson(response),manifest=body?.capability_manifest||body?.manifest||null,validation=validateManifest(manifest);
    if(!response.ok||!validation.ok)return{center,ok:false,http_status:response.status,error:!response.ok?"CENTER_MANIFEST_UNAVAILABLE":"CENTER_MANIFEST_INVALID",validation_errors:validation.errors};
    return{center,ok:true,http_status:response.status,manifest};
  }catch(error){return{center,ok:false,error:String(error?.message||"CENTER_MANIFEST_FAILED")};}
}

export async function collectCapabilityManifests(env){
  const results=await Promise.all(CENTER_BINDINGS.map(([center,name,url])=>fetchCenterManifest(center,env?.[name],url)));
  const own=governanceCapabilityManifest(),validation=validateManifest(own);
  const manifests=validation.ok?[own]:[],errors=validation.ok?[]:[{center:"governance",error:"CENTER_MANIFEST_INVALID",validation_errors:validation.errors}];
  for(const result of results)result.ok?manifests.push(result.manifest):errors.push(result);
  return{ok:errors.length===0,status:errors.length===0?"COMPLETE":"PARTIAL",observed_at:new Date().toISOString(),manifests,errors};
}

function flatten(manifests){
  return manifests.flatMap(manifest=>(manifest.capabilities||[]).map(capability=>({...capability,center:manifest.center})));
}

function scoreCandidate(required,capability){
  if(capability.id===required)return 100;
  if(capability.operations.includes(required))return 95;
  if(capability.substitutes.includes(required))return 90;
  if(capability.compatible_with.includes(required))return 70;
  const requiredWords=words(required),candidateWords=words([capability.id,capability.type,capability.domain,...capability.operations].join(" "));
  return overlap(requiredWords,candidateWords)*10;
}

function permitted(capability,task){
  const constraints=task.constraints||{},risk=task.risk||{};
  if(Array.isArray(constraints.allowed_centers)&&!constraints.allowed_centers.includes(capability.center))return false;
  if(Array.isArray(constraints.denied_providers)&&constraints.denied_providers.includes(capability.provider))return false;
  if(constraints.network==="deny"&&capability.network_scope!=="none")return false;
  if(constraints.write_scope&&constraints.write_scope!==capability.write_scope&&capability.write_scope!=="none")return false;
  const maxTrust=TRUST_LEVELS.includes(risk.max_trust_level)?trustRank(risk.max_trust_level):trustRank("T2");
  if(trustRank(capability.trust.level)>maxTrust)return false;
  return !["failed","deprecated","revoked"].includes(capability.health.status)&&capability.trust.status!=="rejected";
}

export function buildGapModel(requiredCapabilities,capabilities){
  const gaps=[];
  for(const required of requiredCapabilities){
    const candidates=capabilities.map(capability=>({capability,score:scoreCandidate(required,capability)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    if(candidates.length===0)gaps.push({required,type:"missing-capability",pressure:1});
    else if(candidates[0].capability.health.status!=="ready")gaps.push({required,type:"weak-capability",pressure:0.7,best_candidate:candidates[0].capability.id});
    else if(candidates.length===1)gaps.push({required,type:"fragile-capability",pressure:0.4,best_candidate:candidates[0].capability.id});
  }
  return{gap_count:gaps.length,gaps,evolution_pressure:gaps.reduce((sum,gap)=>sum+gap.pressure,0)};
}

export function buildSelfModel(manifests){
  const capabilities=flatten(manifests),byCenter={},operationOwners=new Map();
  for(const capability of capabilities){
    byCenter[capability.center]=(byCenter[capability.center]||0)+1;
    for(const operation of capability.operations){const owners=operationOwners.get(operation)||[];owners.push(capability.id);operationOwners.set(operation,owners)}
  }
  const duplicateOperations=[...operationOwners.entries()].filter(([,owners])=>owners.length>1).map(([operation,owners])=>({operation,owners}));
  const unhealthy=capabilities.filter(capability=>capability.health.status!=="ready").map(capability=>({id:capability.id,center:capability.center,status:capability.health.status}));
  const fragile=[...operationOwners.entries()].filter(([,owners])=>owners.length===1).map(([operation,owners])=>({operation,owner:owners[0]}));
  return{model_version:"self-model-v1",observed_at:new Date().toISOString(),center_count:Object.keys(byCenter).length,capability_count:capabilities.length,by_center:byCenter,healthy_count:capabilities.length-unhealthy.length,unhealthy,duplicate_operations:duplicateOperations,fragile_operations:fragile,capabilities};
}

export function entropyReport(manifests,nowMs=Date.now()){
  const self=buildSelfModel(manifests),stale=[],deprecated=[],dependencyEdges=[];
  for(const capability of self.capabilities){
    const verified=Date.parse(capability.last_verified),ttl=Number(capability.freshness?.ttl_seconds||0)*1000;
    if(!Number.isFinite(verified)||ttl===0||verified+ttl<nowMs)stale.push({id:capability.id,center:capability.center,last_verified:capability.last_verified});
    if(["deprecated","revoked"].includes(capability.health.status))deprecated.push({id:capability.id,center:capability.center,status:capability.health.status});
    for(const dependency of capability.dependencies)dependencyEdges.push({from:capability.id,to:dependency});
  }
  const signals={redundancy:self.duplicate_operations.length,staleness:stale.length,deprecated:deprecated.length,dependency_edges:dependencyEdges.length,fragility:self.fragile_operations.length};
  return{model_version:"entropy-governor-v1",mode:"observe-only",signals,stale,deprecated,duplicate_operations:self.duplicate_operations,proposals:[...deprecated.map(x=>({action:"DEPRECATE",target:x.id,automatic:false})),...stale.map(x=>({action:"REFRESH",target:x.id,automatic:false}))],automatic_delete:false,production_mutation:false};
}

export async function compileTaskPlan(task,manifests){
  const validation=validateTaskEnvelope(task);
  if(!validation.ok)return{ok:false,status:"INVALID",errors:validation.errors,execution_started:false};
  const all=flatten(manifests),selections=[],unresolved=[];
  for(const required of task.required_capabilities){
    const candidates=all.filter(capability=>permitted(capability,task)).map(capability=>({capability,score:scoreCandidate(required,capability)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.capability.fitness.reliability-a.capability.fitness.reliability).slice(0,3);
    if(candidates.length===0){unresolved.push(required);continue;}
    selections.push({required,selected:candidates[0].capability,candidates:candidates.map(x=>({id:x.capability.id,center:x.capability.center,provider:x.capability.provider,score:x.score,trust:x.capability.trust.level,health:x.capability.health.status}))});
  }
  const gapModel=buildGapModel(task.required_capabilities,all),deep=task.required_capabilities.length>1||task.success_criteria.length>2||task.risk?.uncertainty==="high";
  const steps=selections.map((selection,index)=>({step_id:`step-${index+1}`,requires:selection.required,capability_id:selection.selected.id,center:selection.selected.center,provider:selection.selected.provider,depends_on:index===0?[]:[`step-${index}`],fallbacks:selection.candidates.slice(1).map(x=>x.id)}));
  const plan={
    ok:unresolved.length===0,status:unresolved.length?"BLOCKED":"PLANNED",task_id:task.task_id,path:deep?"deep":"fast",runtime:deep?"deterministic-capability-graph":"direct-capability",
    context_compiler:{input_capabilities:all.length,selected_capabilities:selections.length,top_k:3},required_capabilities:task.required_capabilities,selections:selections.map(({required,candidates})=>({required,candidates})),unresolved,
    graph:{nodes:steps,edges:steps.flatMap(step=>step.depends_on.map(from=>({from,to:step.step_id})))},gap_model:gapModel,langgraph_required:deep,langgraph_execution_enabled:false,
    execution_started:false,side_effects_started:false,production_mutation:false,rollback_target:null,created_at:new Date().toISOString()
  };
  return{...plan,plan_digest:await sha256Json(plan)};
}
