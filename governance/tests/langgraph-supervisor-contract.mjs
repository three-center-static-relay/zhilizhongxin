import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtimeSource = await readFile(new URL("../src/langgraph-supervisor.js", import.meta.url), "utf8");
const entrySource = await readFile(new URL("../src/admin-entry.js", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

assert.equal(pkg.dependencies?.["@langchain/langgraph"], undefined);
assert.equal(pkg.dependencies?.["@langchain/core"], undefined);
assert.doesNotMatch(runtimeSource, /from "@langchain\/langgraph"/);
assert.doesNotMatch(runtimeSource, /import\("@langchain\/langgraph"\)/);
assert.match(runtimeSource, /collectCapabilityManifests/);
assert.match(runtimeSource, /compileTaskPlan/);
assert.match(runtimeSource, /https:\/\/expert\.internal\/v1\/langgraph\/health/);
assert.match(runtimeSource, /https:\/\/expert\.internal\/v1\/langgraph\/run/);
assert.match(runtimeSource, /supervisor-validate/);
assert.match(runtimeSource, /model_invoked/);
assert.match(runtimeSource, /autonomous_production_mutation: false/);
assert.match(entrySource, /import\("\.\/langgraph-supervisor\.js"\)/);
assert.doesNotMatch(entrySource, /^import\s+.*from\s+"\.\/langgraph-supervisor\.js"/m);
assert.match(entrySource, /let langGraphSupervisorModulePromise/);
assert.match(entrySource, /await loadLangGraphSupervisor\(\)/);
assert.match(entrySource, /\/v1\/langgraph\/health/);
assert.match(entrySource, /\/v1\/langgraph\/run/);
assert.match(entrySource, /service-binding internal only/);
assert.match(entrySource, /MAX_LANGGRAPH_BODY_BYTES=65536/);

console.log("langgraph-supervisor-contract: PASS");
