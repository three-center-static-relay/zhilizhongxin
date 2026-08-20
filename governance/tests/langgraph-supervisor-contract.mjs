// Governance stays a thin control-plane Worker; the official LangGraph runtime is hosted elsewhere.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const entrySource = await readFile(new URL("../src/admin-entry.js", import.meta.url), "utf8");
const wranglerSource = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

assert.equal(pkg.dependencies?.["@langchain/langgraph"], undefined);
assert.equal(pkg.dependencies?.["@langchain/core"], undefined);
assert.doesNotMatch(entrySource, /langgraph-supervisor\.js/);
assert.doesNotMatch(entrySource, /\/v1\/langgraph\/health/);
assert.doesNotMatch(entrySource, /\/v1\/langgraph\/run/);
assert.match(entrySource, /handleEvolutionRoute/);
assert.match(wranglerSource, /"EXPERT_CENTER"/);
assert.match(wranglerSource, /"INTELLIGENCE_CENTER"/);
assert.match(wranglerSource, /"COMPUTE_CENTER"/);

console.log("langgraph-supervisor-contract: PASS");
