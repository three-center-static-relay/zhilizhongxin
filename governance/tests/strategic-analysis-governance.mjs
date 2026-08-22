import assert from "node:assert/strict";
import {buildStrategicAnalysisPlan,strategicAnalysisGovernanceMeta} from "../src/strategic-analysis-governance.js";
const plan=buildStrategicAnalysisPlan({warning_level:"WARNING",uncertainty:.8,impact:.9,decision_type:"decision"});
assert.equal(plan.ok,true);assert(plan.plan.some(x=>x.center==="intelligence"));assert(plan.plan.some(x=>x.center==="expert"));assert(plan.plan.some(x=>x.center==="compute"));assert(plan.plan.some(x=>x.center==="governance"));assert.equal(plan.principles.external_action_authority,false);assert.equal(plan.principles.automatic_paid_budget_usd,0);
const meta=strategicAnalysisGovernanceMeta();assert(meta.method_families.includes("RAND-robust-decision-making"));assert(meta.method_families.includes("McKinsey-scenario-and-policy-gaming"));assert.equal(meta.decision_support_only,true);
console.log(JSON.stringify({ok:true,suite:"strategic-analysis-governance",centers:plan.plan.map(x=>x.center)}));
