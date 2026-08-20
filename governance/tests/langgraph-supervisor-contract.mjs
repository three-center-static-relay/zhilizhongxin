import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";

const TestState = Annotation.Root({
  value: Annotation(),
  trace: Annotation({
    reducer: (left, right) => [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])],
    default: () => []
  })
});

const graph = new StateGraph(TestState)
  .addNode("increment", async (state) => ({ value: Number(state.value || 0) + 1, trace: ["increment"] }))
  .addEdge(START, "increment")
  .addEdge("increment", END)
  .compile();

const result = await graph.invoke({ value: 1, trace: [] });
assert.equal(result.value, 2);
assert.deepEqual(result.trace, ["increment"]);

const runtimeSource = await readFile(new URL("../src/langgraph-supervisor.js", import.meta.url), "utf8");
const entrySource = await readFile(new URL("../src/admin-entry.js", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

assert.equal(pkg.dependencies?.["@langchain/langgraph"], "1.4.10");
assert.equal(pkg.dependencies?.["@langchain/core"], "1.2.6");
assert.match(runtimeSource, /import\("@langchain\/langgraph"\)/);
assert.doesNotMatch(runtimeSource, /^import\s+.*from\s+"@langchain\/langgraph"/m);
assert.match(runtimeSource, /let langGraphModulePromise/);
assert.match(runtimeSource, /await loadLangGraph\(\)/);
assert.match(runtimeSource, /new StateGraph\(/);
assert.match(runtimeSource, /collectCapabilityManifests/);
assert.match(runtimeSource, /compileTaskPlan/);
assert.match(runtimeSource, /https:\/\/expert\.internal\/v1\/langgraph\/health/);
assert.match(runtimeSource, /autonomous_production_mutation: false/);
assert.match(entrySource, /\/v1\/langgraph\/health/);
assert.match(entrySource, /\/v1\/langgraph\/run/);
assert.match(entrySource, /service-binding internal only/);
assert.match(entrySource, /MAX_LANGGRAPH_BODY_BYTES=65536/);

console.log("langgraph-supervisor-contract: PASS");
