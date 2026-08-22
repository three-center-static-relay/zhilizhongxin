import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildStrategicAnalysisPlan,strategicAnalysisGovernanceMeta} from "../src/strategic-analysis-governance.js";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const repoRoot=path.resolve(root,"..");
const registry=JSON.parse(fs.readFileSync(path.join(root,"config/domain-registry.json"),"utf8"));
const schema=JSON.parse(fs.readFileSync(path.join(root,"schemas/shared-evidence-envelope.schema.json"),"utf8"));
const centerDispatch=JSON.parse(fs.readFileSync(path.join(repoRoot,"src/center-dispatch-registry.json"),"utf8"));
const systemCapabilities=JSON.parse(fs.readFileSync(path.join(repoRoot,"src/system-capability-registry.json"),"utf8"));

assert.equal(registry.version,"domain-capability-fabric-v2-20260817");
assert.deepEqual(registry.architecture.stable_centers,["governance","intelligence","compute","expert"]);
assert.equal(registry.architecture.domain_modules_are_not_repositories,true);
assert.equal(registry.architecture.direct_domain_to_domain_private_code_imports,false);
assert.equal(registry.architecture.unknown_domain_policy,"fail-closed");
assert.equal(registry.architecture.dynamic_task_scoped_composition,true);
assert.equal(registry.architecture.fixed_branch_pairings,false);
assert.equal(registry.architecture.composition_lifetime,"task-scoped");
assert.equal(registry.extension_policy.repository_count_should_not_scale_with_domain_count,true);
assert.equal(registry.extension_policy.prefer_shared_primitive_over_duplicate_domain_model,true);
assert.equal(registry.extension_policy.domain_specific_logic_must_not_relabel_proxy_data_as_observed_data,true);

const ids=registry.domains.map(x=>x.id);
assert.equal(new Set(ids).size,ids.length,"domain ids must be unique");
for(const required of ["medicine","geospatial","commercial","finance-quant","legal-policy","macro-industry","social-behavior","logistics-supply-chain"]){assert.ok(ids.includes(required),`missing required domain: ${required}`)}
for(const domain of registry.domains){assert.match(domain.id,/^[a-z0-9-]{2,64}$/);assert.ok(Array.isArray(domain.default_centers)&&domain.default_centers.length>0);for(const center of domain.default_centers)assert.ok(registry.architecture.stable_centers.includes(center),`unknown center ${center}`);assert.ok(Array.isArray(domain.tags)&&domain.tags.length>0)}

assert.equal(schema.title,"Shared Evidence Envelope v1");
assert.equal(schema.additionalProperties,false);
for(const key of ["evidence_id","source","observed_at","domain_tags","payload_type","provenance","digest_sha256"]){assert.ok(schema.required.includes(key),`schema must require ${key}`)}
assert.equal(schema.properties.digest_sha256.pattern,"^[a-f0-9]{64}$");
assert.ok(schema.properties.quality.properties.observed_vs_proxy.enum.includes("proxy"));
assert.ok(schema.properties.quality.properties.observed_vs_proxy.enum.includes("observed"));
assert.ok(schema.properties.provenance.required.includes("provider"));
assert.ok(schema.properties.provenance.required.includes("retrieval_mode"));

assert.equal(centerDispatch.centers.intelligence.role,"collection_fusion_world_model_and_warning");
assert.ok(centerDispatch.centers.expert.actions.includes("forecast"));
assert.ok(centerDispatch.centers.expert.actions.includes("red-team"));
assert.ok(centerDispatch.centers.compute.actions.includes("forecast-calibrate"));
assert.ok(centerDispatch.centers.compute.actions.includes("robust-decision"));
assert.ok(centerDispatch.governance.controls.includes("scorecard"));
assert.equal(centerDispatch.governance.external_action_authority,false);
assert.ok(systemCapabilities.capabilities.includes("priority-intelligence-requirements"));
assert.ok(systemCapabilities.capabilities.includes("forecast-scorecard"));
assert.equal(systemCapabilities.external_action_authority,false);
const strategic=buildStrategicAnalysisPlan({warning_level:"WARNING",uncertainty:.8,impact:.9,decision_type:"decision"});
assert.equal(strategic.ok,true);assert.ok(strategic.plan.some(x=>x.center==="intelligence"));assert.ok(strategic.plan.some(x=>x.center==="expert"));assert.ok(strategic.plan.some(x=>x.center==="compute"));assert.ok(strategic.plan.some(x=>x.center==="governance"));
const strategicMeta=strategicAnalysisGovernanceMeta();assert.ok(strategicMeta.method_families.includes("RAND-robust-decision-making"));assert.ok(strategicMeta.method_families.includes("McKinsey-scenario-and-policy-gaming"));assert.equal(strategicMeta.external_action_authority,false);

console.log(JSON.stringify({ok:true,suite:"domain-architecture-contract",version:registry.version,domain_count:ids.length,stable_centers:registry.architecture.stable_centers,strategic_analysis_governance:true}));
