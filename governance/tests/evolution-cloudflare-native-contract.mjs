import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {emitEvolutionMetric,EVOLUTION_ANALYTICS_VERSION} from "../src/evolution-telemetry.js";

assert.match(EVOLUTION_ANALYTICS_VERSION,/^cloudflare-analytics-engine-v1-/);
assert.deepEqual(emitEvolutionMetric({},"evolution.plan",{ok:true}),{ok:false,status:"UNBOUND",provider:"cloudflare-analytics-engine"});

const points=[];
const env={EVOLUTION_ANALYTICS:{writeDataPoint(point){points.push(point)}}};
const emitted=emitEvolutionMetric(env,"evolution.plan",{ok:true,status:"PLANNED",task_id:"t-1",path:"deep",capability_count:12,gap_count:1,evolution_pressure:0.4});
assert.equal(emitted.ok,true);
assert.equal(emitted.status,"EMITTED");
assert.equal(points.length,1);
assert.equal(points[0].indexes[0],"evolution.plan");
assert.equal(points[0].blobs[1],"PLANNED");
assert.equal(points[0].doubles[0],1);
assert.equal(points[0].doubles[1],12);
assert.equal(points[0].doubles[3],1);
assert.equal(points[0].doubles[4],0.4);

const wrangler=readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");
assert.match(wrangler,/"analytics_engine_datasets"/);
assert.match(wrangler,/"binding":\s*"EVOLUTION_ANALYTICS"/);
assert.match(wrangler,/"dataset":\s*"three_center_evolution"/);
assert.match(wrangler,/"observability":\s*\{/);
assert.match(wrangler,/"traces":\s*\{/);

console.log(JSON.stringify({ok:true,suite:"evolution-cloudflare-native-contract",analytics_engine:true,workers_observability:true,production_mutation:false}));
