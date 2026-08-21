import fs from "node:fs";
import assert from "node:assert/strict";

const memory = fs.readFileSync(new URL("../src/neon-memory.js", import.meta.url), "utf8");
const router = fs.readFileSync(new URL("../src/neon-memory-router.js", import.meta.url), "utf8");

assert.match(memory, /export async function deleteNeonMemory/, "bounded cleanup primitive required");
assert.match(memory, /DELETE FROM think_tank_memory WHERE memory_id/, "cleanup must target exactly one memory_id");
assert.match(router, /\/_internal\/neon-memory-e2e/, "internal Neon E2E route required");
assert.match(router, /url\.hostname !== "governance\.internal"/, "E2E must be service-binding only");
assert.match(router, /x-three-center-selftest/, "E2E must require selftest header");
assert.match(router, /neon-memory-runtime-e2e-v1/, "stable E2E receipt schema required");
assert.match(router, /readback_ok/, "write must be read back");
assert.match(router, /digest_match/, "stored digest must be verified");
assert.match(router, /cleanup_ok/, "test row must be cleaned up");
assert.match(router, /secret_exposed:\s*false/, "E2E receipt must not expose database secret");
assert.doesNotMatch(router, /NEON_DATABASE_URL/, "router must never read database credential directly");

console.log("neon-runtime-e2e-contract: PASS");
