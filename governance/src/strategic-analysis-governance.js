const VERSION="strategic-analysis-governance-v1";
const clamp=v=>Math.max(0,Math.min(1,Number(v)||0));
export function buildStrategicAnalysisPlan(input={}){
  const warning=String(input.warning_level||"BACKGROUND").toUpperCase(),uncertainty=clamp(input.uncertainty??.5),impact=clamp(input.impact??.5),decisionType=String(input.decision_type||"assessment").toLowerCase();
  const warningRank={BACKGROUND:0,INTEREST:1,WATCH:2,WARNING:3,HIGH_WARNING:4}[warning]??0;
  const plan=[{center:"intelligence",role:"maintain-world-model-and-collection-gaps",required:true}];
  if(warningRank>=2||uncertainty>=.55||impact>=.7)plan.push({center:"expert",role:"all-source-style-assessment-red-team-and-alternatives",required:true});
  if(decisionType==="forecast"||warningRank>=3)plan.push({center:"compute",role:"probability-calibration-and-warning-performance",required:true});
  if(["scenario","policy-game","decision"].includes(decisionType)||uncertainty>=.7)plan.push({center:"compute",role:"robust-scenario-and-assumption-stress",required:true});
  plan.push({center:"governance",role:"priority-routing-validation-and-scorecard",required:true});
  return{ok:true,version:VERSION,decision_type:decisionType,warning_level:warning,uncertainty,impact,plan,principles:{intelligence_collection_separated_from_assessment:true,probability_separated_from_confidence:true,independent_red_team:true,forecast_accuracy_tracked:true,low_probability_high_impact_retained:true,external_action_authority:false,automatic_paid_budget_usd:0,fail_closed:true}}
}
export function strategicAnalysisGovernanceMeta(){return{version:VERSION,center_roles:{intelligence:["priority-requirements","collection-satisfaction","all-source-fusion","warning","retask-recommendations"],expert:["assessment","forecast","alternative-hypotheses","red-team","scenario","policy-game"],compute:["forecast-calibration","signal-detection","robust-decision","assumption-stress","simulation"],governance:["priority-setting","routing","validation","scorecards","feedback"],maintenance:["runtime-health","repair","rollback"]},method_families:["ODNI-analytic-standards","JIO-all-source-assessment","NATO-federated-JISR","NGA-informed-collection-orchestration","RAND-robust-decision-making","assumption-based-planning","McKinsey-scenario-and-policy-gaming","probabilistic-forecast-calibration"],decision_support_only:true,external_action_authority:false}}
