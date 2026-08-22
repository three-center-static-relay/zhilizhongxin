import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const wrangler=readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");
const runtime=readFileSync(new URL("../src/autonomic-runtime.js",import.meta.url),"utf8");
const entry=readFileSync(new URL("../src/autonomic-entry.js",import.meta.url),"utf8");

assert.match(wrangler,/"ai":\s*\{"binding":\s*"AI"\}/);
assert.match(wrangler,/"MAINTENANCE_PRIMARY_MODEL":\s*"@cf\/nvidia\/nemotron-3-120b-a12b"/);
assert.match(wrangler,/"MAINTENANCE_AUTO_PAID_BUDGET_USD":\s*"0"/);
assert.match(wrangler,/"EXPERT_MODEL_SOURCE_CLASSES":\s*"workers-ai,openrouter,huggingface"/);
assert.match(wrangler,/"crons":\s*\["\*\/15 \* \* \* \*"\]/);
assert.match(runtime,/const PRIMARY_MODEL="@cf\/nvidia\/nemotron-3-120b-a12b"/);
assert.match(runtime,/env\.AI\.run\(PRIMARY_MODEL/);
assert.match(runtime,/paid_budget_usd:0/);
assert.match(runtime,/tools:false/);
assert.match(runtime,/web:false/);
assert.match(runtime,/production_mutation:false/);
assert.match(runtime,/statePut/);
assert.match(runtime,/scheduled-health-failure/);
assert.match(entry,/runScheduledAutonomicPulse/);
assert.match(entry,/\/v1\/maintenance\/autonomic/);
console.log(JSON.stringify({ok:true,suite:"autonomic-nemotron-maintenance",primary_model:"@cf/nvidia/nemotron-3-120b-a12b",durable_state:true,scheduled_recovery:true,paid_budget_usd:0}));
