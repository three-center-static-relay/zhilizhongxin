import { ensureNeonMemorySchema, neonMemoryHealth, neonMemoryStatus, readRecentNeonMemory, storeNeonMemory } from "./neon-memory.js";

const MAX_BODY_BYTES = 131072;
const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function constantTimeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authenticate(request, env) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return { ok: false, status: 401, error: "UNAUTHORIZED" };
  if (!env.ADMIN_GPT_TOKEN) return { ok: false, status: 503, error: "ADMIN_TOKEN_NOT_CONFIGURED" };
  return constantTimeEqual(header.slice(7).trim(), env.ADMIN_GPT_TOKEN) ? { ok: true } : { ok: false, status: 401, error: "UNAUTHORIZED" };
}

async function strictJson(request, allowedKeys) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 });
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error("INVALID_REQUEST"), { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("INVALID_REQUEST"), { status: 400 });
  for (const key of Object.keys(body)) if (!allowedKeys.has(key)) throw Object.assign(new Error("UNKNOWN_FIELD"), { status: 400, field: key });
  return body;
}

async function authorized(request, env, operation) {
  const auth = authenticate(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error, http_status: auth.status }, auth.status);
  try { return json(await operation()); }
  catch (error) { return json({ ok: false, error: String(error?.message || "NEON_MEMORY_ROUTE_FAILED").slice(0, 160), http_status: error?.status || 500, secret_exposed: false }, error?.status || 500); }
}

export async function handleNeonMemoryRoute(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/_internal/neon-memory-health") {
    if (url.hostname !== "governance.internal" || request.headers.get("x-three-center-selftest") !== "1") return json({ ok: false, error: "NOT_FOUND" }, 404);
    return json(await neonMemoryHealth(env), 200);
  }

  if (request.method === "GET" && url.pathname === "/v1/admin/memory/status") {
    return authorized(request, env, async () => ({ ok: true, ...neonMemoryStatus(env), production_mutation: false }));
  }

  if (request.method === "GET" && url.pathname === "/v1/admin/memory/health") {
    return authorized(request, env, async () => ({ ...(await neonMemoryHealth(env)), production_mutation: false }));
  }

  if (request.method === "POST" && url.pathname === "/v1/admin/memory/bootstrap") {
    return authorized(request, env, async () => ({ ...(await ensureNeonMemorySchema(env)), metadata_write: true, production_mutation: false, secret_exposed: false }));
  }

  if (request.method === "POST" && url.pathname === "/v1/admin/memory/write") {
    return authorized(request, env, async () => {
      const body = await strictJson(request, new Set(["memory_id", "task_id", "center", "kind", "payload"]));
      return { ...(await storeNeonMemory(env, body)), metadata_write: true, production_mutation: false };
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/admin/memory/query") {
    return authorized(request, env, async () => {
      const body = await strictJson(request, new Set(["task_id", "center", "kind", "limit"]));
      return { ...(await readRecentNeonMemory(env, body)), production_mutation: false };
    });
  }

  return null;
}
