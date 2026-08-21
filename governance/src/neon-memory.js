import { neon } from "@neondatabase/serverless";

export const NEON_MEMORY_SCHEMA = "think-tank-memory-v1";
export const NEON_MEMORY_SECRET = "NEON_DATABASE_URL";

const ALLOWED_CENTERS = new Set(["governance", "intelligence", "compute", "expert", "system"]);
const MAX_PAYLOAD_BYTES = 131072;
const MAX_STRING = 4000;
const MAX_DEPTH = 8;
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|database[_-]?url|connection[_-]?string)/i;
let schemaReadyPromise = null;

function timeout(promise, ms, code) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function configured(env) {
  return typeof env?.[NEON_MEMORY_SECRET] === "string" && env[NEON_MEMORY_SECRET].trim().length > 0;
}

function sqlFor(env) {
  if (!configured(env)) return null;
  return neon(env[NEON_MEMORY_SECRET]);
}

function sanitize(value, key = "", depth = 0) {
  if (SENSITIVE_KEY.test(String(key || ""))) return "[REDACTED]";
  if (depth > MAX_DEPTH) return "[DEPTH_LIMIT]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, key, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 200)) out[childKey] = sanitize(childValue, childKey, depth + 1);
    return out;
  }
  return String(value).slice(0, MAX_STRING);
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeText(value, max, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().slice(0, max) || fallback;
}

export function neonMemoryStatus(env) {
  return {
    configured: configured(env),
    provider: "neon-postgresql",
    schema: NEON_MEMORY_SCHEMA,
    secret_name: NEON_MEMORY_SECRET,
    secret_exposed: false,
    shared_by_centers: true,
    owner: "governance-la",
    direct_center_credentials: false
  };
}

export async function ensureNeonMemorySchema(env) {
  if (!configured(env)) return { ok: false, configured: false, error: "NEON_DATABASE_URL_NOT_CONFIGURED" };
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const sql = sqlFor(env);
      await timeout(sql`
        CREATE TABLE IF NOT EXISTS think_tank_memory (
          memory_id TEXT PRIMARY KEY,
          task_id TEXT,
          center TEXT NOT NULL,
          kind TEXT NOT NULL,
          observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          payload JSONB NOT NULL,
          payload_sha256 TEXT NOT NULL,
          schema_version TEXT NOT NULL
        )
      `, 10000, "NEON_SCHEMA_TIMEOUT");
      await timeout(sql`CREATE INDEX IF NOT EXISTS think_tank_memory_task_idx ON think_tank_memory (task_id, observed_at DESC)`, 10000, "NEON_SCHEMA_TIMEOUT");
      await timeout(sql`CREATE INDEX IF NOT EXISTS think_tank_memory_center_kind_idx ON think_tank_memory (center, kind, observed_at DESC)`, 10000, "NEON_SCHEMA_TIMEOUT");
      return true;
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
  return { ok: true, configured: true, schema: NEON_MEMORY_SCHEMA };
}

export async function neonMemoryHealth(env) {
  if (!configured(env)) return { ok: false, configured: false, error: "NEON_DATABASE_URL_NOT_CONFIGURED", ...neonMemoryStatus(env) };
  try {
    const sql = sqlFor(env);
    const rows = await timeout(sql`SELECT 1::int AS ok`, 5000, "NEON_HEALTH_TIMEOUT");
    return {
      ok: Number(rows?.[0]?.ok) === 1,
      configured: true,
      provider: "neon-postgresql",
      schema: NEON_MEMORY_SCHEMA,
      secret_exposed: false
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      provider: "neon-postgresql",
      schema: NEON_MEMORY_SCHEMA,
      error: String(error?.message || "NEON_HEALTH_FAILED").slice(0, 160),
      secret_exposed: false
    };
  }
}

export async function storeNeonMemory(env, record = {}) {
  if (!configured(env)) return { ok: false, configured: false, stored: false, error: "NEON_DATABASE_URL_NOT_CONFIGURED" };
  const center = normalizeText(record.center, 40, "system");
  if (!ALLOWED_CENTERS.has(center)) return { ok: false, configured: true, stored: false, error: "INVALID_MEMORY_CENTER" };
  const kind = normalizeText(record.kind, 80);
  if (!kind) return { ok: false, configured: true, stored: false, error: "INVALID_MEMORY_KIND" };
  const taskId = normalizeText(record.task_id, 160);
  const memoryId = normalizeText(record.memory_id, 180, `${center}:${kind}:${taskId || crypto.randomUUID()}:${crypto.randomUUID()}`);
  const safePayload = sanitize(record.payload ?? {});
  const serialized = JSON.stringify(safePayload);
  if (new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) return { ok: false, configured: true, stored: false, error: "MEMORY_PAYLOAD_TOO_LARGE" };
  const payloadDigest = await sha256(serialized);
  try {
    await ensureNeonMemorySchema(env);
    const sql = sqlFor(env);
    const rows = await timeout(sql`
      INSERT INTO think_tank_memory (memory_id, task_id, center, kind, observed_at, payload, payload_sha256, schema_version)
      VALUES (${memoryId}, ${taskId}, ${center}, ${kind}, NOW(), ${serialized}::jsonb, ${payloadDigest}, ${NEON_MEMORY_SCHEMA})
      ON CONFLICT (memory_id) DO UPDATE SET
        task_id = EXCLUDED.task_id,
        center = EXCLUDED.center,
        kind = EXCLUDED.kind,
        observed_at = EXCLUDED.observed_at,
        payload = EXCLUDED.payload,
        payload_sha256 = EXCLUDED.payload_sha256,
        schema_version = EXCLUDED.schema_version
      RETURNING memory_id, payload_sha256, observed_at
    `, 10000, "NEON_WRITE_TIMEOUT");
    return {
      ok: true,
      configured: true,
      stored: true,
      memory_id: rows?.[0]?.memory_id || memoryId,
      payload_sha256: rows?.[0]?.payload_sha256 || payloadDigest,
      observed_at: rows?.[0]?.observed_at || null,
      secret_exposed: false
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      stored: false,
      error: String(error?.message || "NEON_WRITE_FAILED").slice(0, 160),
      secret_exposed: false
    };
  }
}

export async function readRecentNeonMemory(env, filters = {}) {
  if (!configured(env)) return { ok: false, configured: false, records: [], error: "NEON_DATABASE_URL_NOT_CONFIGURED" };
  const center = normalizeText(filters.center, 40);
  if (center && !ALLOWED_CENTERS.has(center)) return { ok: false, configured: true, records: [], error: "INVALID_MEMORY_CENTER" };
  const kind = normalizeText(filters.kind, 80);
  const taskId = normalizeText(filters.task_id, 160);
  const limit = Math.max(1, Math.min(50, Number(filters.limit) || 20));
  try {
    await ensureNeonMemorySchema(env);
    const sql = sqlFor(env);
    const rows = await timeout(sql`
      SELECT memory_id, task_id, center, kind, observed_at, payload, payload_sha256, schema_version
      FROM think_tank_memory
      WHERE (${center}::text IS NULL OR center = ${center})
        AND (${kind}::text IS NULL OR kind = ${kind})
        AND (${taskId}::text IS NULL OR task_id = ${taskId})
      ORDER BY observed_at DESC
      LIMIT ${limit}
    `, 10000, "NEON_READ_TIMEOUT");
    return { ok: true, configured: true, records: Array.isArray(rows) ? rows : [], secret_exposed: false };
  } catch (error) {
    return { ok: false, configured: true, records: [], error: String(error?.message || "NEON_READ_FAILED").slice(0, 160), secret_exposed: false };
  }
}
