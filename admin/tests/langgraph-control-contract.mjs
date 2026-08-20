import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const control=await readFile(new URL("../src/langgraph-control.js",import.meta.url),"utf8");
const entry=await readFile(new URL("../src/production-entry.js",import.meta.url),"utf8");
const wrangler=await readFile(new URL("../wrangler.jsonc",import.meta.url),"utf8");

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
assert.match(entry,/handleLangGraphControl/);
for(const binding of ["GOVERNANCE_CENTER","INTELLIGENCE_CENTER","COMPUTE_CENTER","EXPERT_CENTER"])assert.match(wrangler,new RegExp(`"${binding}"`));

console.log("langgraph-control-contract: PASS");
