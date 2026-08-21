import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const control=await readFile(new URL("../src/langgraph-control.js",import.meta.url),"utf8");
const test=await readFile(new URL("../src/langgraph-test.js",import.meta.url),"utf8");
const entry=await readFile(new URL("../src/production-entry.js",import.meta.url),"utf8");
const wrangler=await readFile(new URL("../wrangler.jsonc",import.meta.url),"utf8");
const openapi=await readFile(new URL("../openapi.json",import.meta.url),"utf8");

assert.match(control,/https:\/\/governance\.internal\/v1\/evolution\/internal-plan/);
assert.match(control,/https:\/\/expert\.internal\/v1\/langgraph\/run/);
assert.match(control,/supervisor-validate/);
assert.match(control,/https:\/\/expert\.internal\/v1\/selftest/);
assert.match(control,/langgraph-system-command-v1/);
assert.match(control,/brain_can_command/);
assert.match(control,/governance\.task-planner/);
assert.match(control,/intelligence\.provider-query/);
assert.match(control,/compute\.cpu/);
assert.match(control,/expert\.deliberation/);
assert.match(control,/production_mutation:false/);

assert.match(test,/\/v1\/admin\/langgraph\/test/);
assert.match(test,/ADMIN_GPT_TOKEN/);
assert.match(test,/https:\/\/admin\.internal\/v1\/admin\/langgraph\/run/);
assert.match(test,/https:\/\/expert\.internal\/v1\/run/);
assert.match(test,/governance\.task-planner/);
assert.match(test,/expert\.deliberation/);
assert.match(test,/expert\.judgment/);
assert.match(test,/internal_workers_publicly_exposed:false/);
assert.match(test,/service_binding_dispatch:true/);
assert.match(test,/production_mutation:false/);
assert.match(test,/tools_used:false/);
assert.match(test,/web_used:false/);
assert.match(entry,/handleLangGraphControl/);
assert.match(entry,/handleLangGraphTest/);
assert.match(openapi,/"\/v1\/admin\/langgraph\/test"/);
assert.match(openapi,/"operationId": "runLangGraphExpertTest"/);
for(const binding of ["GOVERNANCE_CENTER","INTELLIGENCE_CENTER","COMPUTE_CENTER","EXPERT_CENTER"])assert.match(wrangler,new RegExp(`"${binding}"`));

console.log("langgraph-control-contract: PASS");
