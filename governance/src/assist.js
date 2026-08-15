const FREE_MODELS = Object.freeze([
  "@cf/zai-org/glm-4.7-flash",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/meta/llama-4-scout-17b-16e-instruct"
]);

const MAX_BODY_BYTES = 65536;
const DEFAULT_MAX_TOKENS = 4096;
const MAX_MAX_TOKENS = 16384;

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}

function constantTimeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function parseBody(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 });
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("INVALID_REQUEST"), { status: 400 }); }
}

function shuffledModels() {
  const out = [...FREE_MODELS];
  const random = new Uint32Array(out.length || 1);
  crypto.getRandomValues(random);
  for (let i = out.length - 1; i > 0; i--) {
    const j = random[i] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function authenticate(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return { ok: false, status: 401, error: "UNAUTHORIZED" };
  if (!env.ADMIN_GPT_TOKEN) return { ok: false, status: 503, error: "ADMIN_TOKEN_NOT_CONFIGURED" };
  const token = authorization.slice(7).trim();
  if (!constantTimeEqual(token, env.ADMIN_GPT_TOKEN)) return { ok: false, status: 401, error: "UNAUTHORIZED" };
  return { ok: true, status: 200, error: null };
}

function extractContent(output) {
  if (typeof output === "string" && output.trim()) return output.trim();
  if (typeof output?.response === "string" && output.response.trim()) return output.response.trim();
  if (typeof output?.result?.response === "string" && output.result.response.trim()) return output.result.response.trim();
  const choice = output?.choices?.[0]?.message?.content;
  if (typeof choice === "string" && choice.trim()) return choice.trim();
  if (Array.isArray(choice)) {
    const text = choice.map(item => typeof item === "string" ? item : item?.text || "").join("\n").trim();
    if (text) return text;
  }
  throw new Error("EMPTY_MODEL_OUTPUT");
}

function looksLikeSharedQuota(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return text.includes("neuron") || text.includes("daily quota") || text.includes("quota exceeded") || text.includes("limit exceeded");
}

async function workersAiAttempt(env, model, messages, maxTokens) {
  if (!env.AI?.run) throw new Error("WORKERS_AI_BINDING_UNAVAILABLE");
  return env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.2, stream: false });
}

async function openRouterFallback(env, body) {
  if (!env.OPENROUTER_RELAY?.fetch) {
    return json({ ok: false, error: "OPENROUTER_RELAY_UNAVAILABLE", web_gpt_fallback_required: true }, 503);
  }
  const response = await env.OPENROUTER_RELAY.fetch(new Request("https://expert.internal/v1/governance-assist", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  }));
  const payload = await response.json().catch(() => null);
  if (response.ok && payload?.ok) return json(payload, 200);
  return json({
    ok: false,
    error: payload?.error || "OPENROUTER_CHAIN_FAILED",
    web_gpt_fallback_required: true,
    openrouter: payload || null
  }, 503);
}

export function assistRoutingInfo() {
  return {
    mode: "single-model-serial-failover",
    cloudflare: { selection: "shuffle-once-per-task", free_only: true, model_count: FREE_MODELS.length, models: [...FREE_MODELS] },
    openrouter: { free_models: false, paid_only: true, ranking: "intelligence-high-to-low", sequential: true },
    final_fallback: "web-gpt"
  };
}

export async function runAssist(request, env) {
  const auth = authenticate(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const body = await parseBody(request);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return json({ ok: false, error: "INVALID_REQUEST", message: "prompt required" }, 400);
    const maxTokens = boundedInt(body.max_tokens, DEFAULT_MAX_TOKENS, 256, MAX_MAX_TOKENS);
    const system = typeof body.system === "string" && body.system.trim()
      ? body.system.trim()
      : "You are the governance copilot for the controlling web GPT. Handle repository governance, code review, fault diagnosis, maintenance planning, routing advice, policy interpretation, and decision support. Preserve existing hard governance rules, never claim unexecuted actions, and state uncertainty explicitly.";
    const messages = [{ role: "system", content: system }, { role: "user", content: prompt }];
    const models = shuffledModels();
    const attempts = [];
    for (const model of models) {
      const started = Date.now();
      try {
        const output = await workersAiAttempt(env, model, messages, maxTokens);
        const content = extractContent(output);
        attempts.push({ provider: "cloudflare-workers-ai", model, status: "completed", elapsed_ms: Date.now() - started });
        return json({
          ok: true,
          provider: "cloudflare-workers-ai",
          selection: "free-random-shuffle-once",
          model,
          content,
          usage: output?.usage || null,
          attempts
        });
      } catch (error) {
        attempts.push({ provider: "cloudflare-workers-ai", model, status: "failed", error: String(error?.message || error), elapsed_ms: Date.now() - started });
        if (looksLikeSharedQuota(error)) break;
      }
    }
    const fallback = await openRouterFallback(env, { prompt, system, max_tokens: maxTokens });
    const payload = await fallback.clone().json().catch(() => null);
    if (fallback.ok && payload?.ok) {
      return json({ ...payload, cloudflare_attempts: attempts });
    }
    return json({
      ok: false,
      error: payload?.error || "ALL_MODEL_PROVIDERS_FAILED",
      cloudflare_attempts: attempts,
      web_gpt_fallback_required: true
    }, 503);
  } catch (error) {
    return json({ ok: false, error: String(error?.message || "INTERNAL_ERROR"), web_gpt_fallback_required: true }, error?.status || 500);
  }
}
