import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/admin-entry.js";

const snapshot = JSON.parse(readFileSync(new URL("../web-gpt-action/LATEST.openapi.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../web-gpt-action/manifest.json", import.meta.url), "utf8"));
const server = manifest.production_server;

const response = await worker.fetch(new Request(`${server}/openapi.json`, { method: "GET" }), {}, {});
assert.equal(response.status, 200, "deployed entrypoint must generate OpenAPI successfully");
const runtime = await response.json();

function actionProjection(spec) {
  return {
    openapi: spec.openapi,
    info: {
      title: spec.info?.title,
      version: spec.info?.version
    },
    servers: spec.servers,
    paths: spec.paths,
    components: spec.components
  };
}

assert.deepEqual(
  actionProjection(snapshot),
  actionProjection(runtime),
  "LATEST.openapi.json drifted from src/admin-entry.js; update the canonical Web GPT Action snapshot in the same PR"
);

assert.equal(manifest.status, "LATEST");
assert.equal(manifest.canonical_file, "governance/web-gpt-action/LATEST.openapi.json");
assert.equal(manifest.source_entry, "governance/src/admin-entry.js");
assert.equal(manifest.copy_paste_ready, true);
assert.equal(manifest.secret_free, true);
assert.equal(snapshot.servers?.length, 1);
assert.equal(snapshot.servers?.[0]?.url, server);
assert.deepEqual(snapshot.components?.schemas, {});
assert.equal(snapshot.components?.securitySchemes?.BearerAuth?.type, "http");
assert.equal(snapshot.components?.securitySchemes?.BearerAuth?.scheme, "bearer");

const operations = [];
for (const [path, pathItem] of Object.entries(snapshot.paths || {})) {
  for (const [method, operation] of Object.entries(pathItem || {})) {
    assert.equal(typeof operation.operationId, "string", `${method.toUpperCase()} ${path} must have operationId`);
    assert.ok(operation.operationId.length > 0, `${method.toUpperCase()} ${path} operationId must not be empty`);
    if (operation.description !== undefined) {
      assert.ok(operation.description.length <= 300, `${operation.operationId} description exceeds 300 characters`);
    }
    operations.push(operation.operationId);
  }
}

assert.equal(new Set(operations).size, operations.length, "operationId values must be unique");
assert.deepEqual([...operations].sort(), [...manifest.required_operation_ids].sort(), "manifest operation list must exactly match the canonical Action schema");

const raw = JSON.stringify(snapshot);
assert.equal(raw.includes("ADMIN_GPT_TOKEN"), false, "Action snapshot must never contain the controller secret name/value");
assert.equal(/Bearer\s+[A-Za-z0-9._~-]{16,}/.test(raw), false, "Action snapshot appears to contain a bearer credential");
assert.equal(/sk-[A-Za-z0-9_-]{12,}/.test(raw), false, "Action snapshot appears to contain an API credential");

console.log(JSON.stringify({
  ok: true,
  suite: "web-gpt-action-canonical-latest",
  snapshot_version: manifest.snapshot_version,
  server,
  operations,
  operation_count: operations.length,
  drift_guard: true,
  secret_free: true,
  copy_paste_ready: true
}));
