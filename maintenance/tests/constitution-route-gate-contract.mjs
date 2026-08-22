import assert from "node:assert/strict";
import fs from "node:fs";
import {MAINTENANCE_CONSTITUTION,validateExpertRouteMutation,assertExpertRouteMutation} from "../src/constitution-gate.js";

const digest="a".repeat(64);
const plan={
  plan_digest:digest,
  routing_fingerprint:"b".repeat(64),
  summary:{
    candidate_count:12,
    company_count:4,
    providers:["workers-ai","openrouter"],
    telemetry_payload_read:false,
    model_id_pinning:false
  },
  routes:[{routeName:"expert-panel-lanes-1-2-v1",lanes:["1","2"]}]
};

assert.equal(MAINTENANCE_CONSTITUTION.version,"1.1");
assert.equal(validateExpertRouteMutation(plan).ok,true);
assert.equal(assertExpertRouteMutation(plan).verdict,"PASS");
assert.equal(validateExpertRouteMutation({...plan,plan_digest:"bad"}).ok,false);
assert.equal(validateExpertRouteMutation({...plan,summary:{...plan.summary,providers:["unapproved-provider"]}}).ok,false);
assert.equal(validateExpertRouteMutation({...plan,summary:{...plan.summary,telemetry_payload_read:true}}).ok,false);
assert.equal(validateExpertRouteMutation({...plan,summary:{...plan.summary,model_id_pinning:true}}).ok,false);
assert.throws(()=>assertExpertRouteMutation({...plan,routes:[]}),/CONSTITUTION_ROUTE_GATE_DENIED/);

const manager=fs.readFileSync(new URL("../src/expert-route-manager.js",import.meta.url),"utf8");
assert.match(manager,/constitution-gate\.js/);
assert.match(manager,/assertExpertRouteMutation\(plan\)/);
assert.match(manager,/constitution_gate:constitution/);

console.log("constitution-route-gate-contract: PASS");
