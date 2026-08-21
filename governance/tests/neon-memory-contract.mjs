import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("../src/neon-memory.js", import.meta.url), "utf8");
const router = fs.readFileSync(new URL("../src/neon-memory-router.js", import.meta.url), "utf8");
const adminEntry = fs.readFileSync(new URL("../src/admin-entry.js", import.meta.url), "utf8");
const supervisor = fs.readFileSync(new URL("../src/langgraph-supervisor.js", import.meta.url), "utf8");
const evolution = fs.readFileSync(new URL("../src/evolution-router.js", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const wrangler = fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

assert.equal(pkg.dependencies?.["@neondatabase/serverless"], "1.1.0", "Neon serverless driver must be exactly pinned");
assert.match(source, /NEON_DATABASE_URL/, "runtime secret name must be NEON_DATABASE_URL");
assert.match(source, /think_tank_memory/, "shared memory table must be present");
assert.match(source, /SENSITIVE_KEY/, "payloads must be redacted before persistence");
assert.match(source, /MAX_PAYLOAD_BYTES/, "memory writes must be bounded");
assert.match(source, /secret_exposed:\s*false/g, "memory receipts must never expose the connection string");
assert.doesNotMatch(wrangler, /NEON_DATABASE_URL\s*[:=]\s*["'][^"']+["']/, "connection string must never be committed to wrangler config");

assert.match(router, /\/v1\/admin\/memory\/status/, "authenticated memory status route must exist");
assert.match(router, /\/v1\/admin\/memory\/health/, "authenticated memory health route must exist");
assert.match(router, /\/v1\/admin\/memory\/bootstrap/, "explicit schema bootstrap route must exist");
assert.match(router, /\/v1\/admin\/memory\/write/, "explicit bounded memory write route must exist");
assert.match(router, /\/v1\/admin\/memory\/query/, "bounded memory query route must exist");
assert.match(router, /ADMIN_GPT_TOKEN/, "memory broker must reuse governance authentication");
assert.match(router, /production_mutation:\s*false/g, "memory metadata writes must never be represented as production deployment mutation");
assert.match(adminEntry, /handleNeonMemoryRoute/, "governance worker must mount the memory broker");

assert.doesNotMatch(supervisor, /storeNeonMemory/, "LangGraph validation must remain side-effect free");
assert.doesNotMatch(evolution, /storeNeonMemory/, "evolution planning must remain side-effect free");
assert.doesNotMatch(supervisor, /NEON_DATABASE_URL/, "supervisor must not read database credentials directly");
assert.doesNotMatch(evolution, /NEON_DATABASE_URL/, "evolution router must not read database credentials directly");

console.log("neon-memory-contract: PASS");
