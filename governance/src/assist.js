import { buildGovernanceSystem, deterministicPolicyDecision, validateModelContent } from "./assist-policy.js";

// Governance routing priority: strongest validated Workers Free-plan model first.
// Order is intentionally deterministic; a model is attempted only after every stronger
// predecessor failed. Shared-quota exhaustion skips the remaining Cloudflare pool.
const FREE_MODELS_STRONGEST_FIRST = Object.freeze([
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/meta/llama-4-scout-17b-16e-instruct"
]);

const ASSIST_PROFILE_NAME = "governance-assist-high-reasoning-v1";
const FIXED_SAMPLING = Object.freeze({
  temperature: 0.2,
  top_p: 0.9,
  stream: false
});
const HIGH_REASONING_MODELS = new Set([
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/zai-org/glm-4.7-flash"
]);
const ASSIST_EXECUTION_SYSTEM = `FIXED GOVERNANCE ASSISTANT EXECUTION PROFILE:
- Apply rigorous internal reasoning before answering governance, code, diagnosis, routing, maintenance, and decision-support tasks.
- Use the provider's highest supported reasoning effort when an explicit reasoning-effort control is available. For models without a compatible control, preserve the same high-reasoning behavior through these system instructions rather than inventing unsupported parameters.
- Do not reveal private chain-of-thought. Return conclusions, supporting evidence, uncertainty, and recommended actions instead.
- Prefer deterministic, evidence-disciplined answers over creative variation.
- Be concise by default, but do not omit material risks, contradictions, or unknowns.
- Never weaken the immutable governance rules above.`;

const MAX_BODY_BYTES = 65536;
const DEFAULT_MAX_TOKENS = 4096;
const MAX_MAX_TOKENS = 16384;
const SELFTEST_OPENROUTER = "__SELFTEST_OPENROUTER_FALLBACK__";
const SELFTEST_WEBGPT = "__SELFTEST_WEBGPT_FALLBACK__";

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

function workersAiParameters(model, messages, maxTokens) {
  const params = {
    messages,
    max_tokens: maxTokens,
    ...FIXED_SAMPLING
  };
  if (HIGH_REASONING_MODELS.has(model)) params.reasoning_effort = "high";
  return params;
}

async function workersAiAttempt(env, model, messages, maxTokens) {
  if (!env.AI?.run) throw new Error("WORKERS_AI_BINDING_UNAVAILABLE");
  return env.AI.run(model, workersAiParameters(model, messages, maxTokens));
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
    generation_profile: {
      name: ASSIST_PROFILE_NAME,
      fixed_system_prompt: true,
      sampling: { ...FIXED_SAMPLING },
      reasoning_effort: "high",
      reasoning_effort_models: [...HIGH_REASONING_MODELS],
      unsupported_reasoning_control_behavior: "system-prompt-enforced",
      max_tokens: { default: DEFAULT_MAX_TOKENS, min: 256, max: MAX_MAX_TOKENS }
    },
    cloudflare: {
      selection: "strongest-first-sequential",
      ranking: "governance-intelligence-high-to-low",
      free_only: true,
      deterministic_order: true,
      model_count: FREE_MODELS_STRONGEST_FIRST.length,
      models: [...FREE_MODELS_STRONGEST_FIRST]
    },
    openrouter: { free_models: false, paid_only: true, ranking: "intelligence-high-to-low", sequential: true, reasoning_effort: "high" },
    final_fallback: "web-gpt",
    authenticated_selftests: ["openrouter-fallback", "webgpt-fallback"]
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
    const system = `${buildGovernanceSystem(body.system)}\n\n${ASSIST_EXECUTION_SYSTEM}`;

    if (prompt === SELFTEST_OPENROUTER) {
      const fallback = await openRouterFallback(env, {
        prompt: "Reply exactly: OPENROUTER_FALLBACK_OK",
        system,
        max_tokens: 256,
        generation_profile: ASSIST_PROFILE_NAME
      });
      const payload = await fallback.clone().json().catch(() => null);
      if (fallback.ok && payload?.ok) {
        return json({
          ...payload,
          selftest: "openrouter-fallback",
          cloudflare_bypassed: true,
          cloudflare_attempts: [],
          generation_profile: ASSIST_PROFILE_NAME
        });
      }
      return json({
        ...(payload || {}),
        ok: false,
        selftest: "openrouter-fallback",
        cloudflare_bypassed: true,
        cloudflare_attempts: [],
        web_gpt_fallback_required: true,
        generation_profile: ASSIST_PROFILE_NAME
      }, fallback.status || 503);
    }

    if (prompt === SELFTEST_WEBGPT) {
      return json({
        ok: false,
        error: "SELFTEST_FORCED_ALL_PROVIDERS_FAILED",
        selftest: "webgpt-fallback",
        cloudflare_bypassed: true,
        openrouter_bypassed: true,
        web_gpt_fallback_required: true,
        generation_profile: ASSIST_PROFILE_NAME,
        message: "Controlled self-test: upstream providers were intentionally bypassed; the controlling web GPT should take over this request."
      }, 503);
    }

    const hardDecision = deterministicPolicyDecision(prompt);
    if (hardDecision) {
      return json({
        ok: true,
        provider: "governance-policy-kernel",
        selection: "deterministic-hard-rule",
        model: null,
        content: hardDecision,
        usage: null,
        attempts: [],
        generation_profile: ASSIST_PROFILE_NAME
      });
    }

    const messages = [{ role: "system", content: system }, { role: "user", content: prompt }];
    const models = [...FREE_MODELS_STRONGEST_FIRST];
    const attempts = [];
    for (let rank = 0; rank < models.length; rank++) {
      const model = models[rank];
      const started = Date.now();
      try {
        const output = await workersAiAttempt(env, model, messages, maxTokens);
        const content = validateModelContent(prompt, output, extractContent(output));
        attempts.push({ provider: "cloudflare-workers-ai", rank: rank + 1, model, status: "completed", elapsed_ms: Date.now() - started });
        return json({
          ok: true,
          provider: "cloudflare-workers-ai",
          selection: "free-strongest-first-sequential",
          model,
          rank: rank + 1,
          content,
          usage: output?.usage || null,
          attempts,
          generation_profile: ASSIST_PROFILE_NAME
        });
      } catch (error) {
        attempts.push({ provider: "cloudflare-workers-ai", rank: rank + 1, model, status: "failed", error: String(error?.message || error), elapsed_ms: Date.now() - started });
        if (looksLikeSharedQuota(error)) break;
      }
    }
    const fallback = await openRouterFallback(env, { prompt, system, max_tokens: maxTokens, generation_profile: ASSIST_PROFILE_NAME });
    const payload = await fallback.clone().json().catch(() => null);
    if (fallback.ok && payload?.ok) {
      return json({ ...payload, cloudflare_attempts: attempts, generation_profile: ASSIST_PROFILE_NAME });
    }
    return json({
      ok: false,
      error: payload?.error || "ALL_MODEL_PROVIDERS_FAILED",
      cloudflare_attempts: attempts,
      web_gpt_fallback_required: true,
      generation_profile: ASSIST_PROFILE_NAME
    }, 503);
  } catch (error) {
    return json({ ok: false, error: String(error?.message || "INTERNAL_ERROR"), web_gpt_fallback_required: true, generation_profile: ASSIST_PROFILE_NAME }, error?.status || 500);
  }
}
