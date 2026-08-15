import base from "./index.js";
import { assistRoutingInfo, runAssist } from "./assist.js";

const POLICY_KERNEL_VERSION = "deterministic-v1";
const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function augmentBaseResponse(request, env, ctx) {
  const response = await base.fetch(request, env, ctx);
  if (!response.ok) return response;
  const url = new URL(request.url);
  if (!new Set(["/health", "/v1/policy", "/policy", "/v1/capabilities", "/capabilities", "/v1/quota", "/quota", "/openapi.json"]).has(url.pathname)) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object") return response;
  const routing = assistRoutingInfo();
  if (url.pathname === "/health") return json({ ...body, ai_assist: true, routing_mode: routing.mode, policy_kernel: POLICY_KERNEL_VERSION });
  if (url.pathname === "/v1/policy" || url.pathname === "/policy") {
    return json({ ...body, policy: { ...(body.policy || {}), single_model_serial: true, parallel_models: false, cloudflare_free_first: true, openrouter_paid_only_fallback: true, web_gpt_final_fallback: true, hard_rules_immutable: true, deterministic_policy_kernel: true } });
  }
  if (url.pathname === "/v1/capabilities" || url.pathname === "/capabilities") {
    return json({ ...body, capabilities: { ...(body.capabilities || {}), governance_ai_assist: true, workers_ai_random_failover: true, openrouter_paid_ranked_failover: true, web_gpt_final_fallback: true, deterministic_policy_kernel: true, model_output_contract_validation: true } });
  }
  if (url.pathname === "/v1/quota" || url.pathname === "/quota") return json({ ...body, ai_routing: routing, policy_kernel: POLICY_KERNEL_VERSION });
  if (url.pathname === "/openapi.json") {
    return json({ ...body, paths: { ...(body.paths || {}), "/v1/assist": { post: { summary: "Run authenticated governance AI assistance with deterministic hard-policy enforcement and serial model failover" } } } });
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/assist") return runAssist(request, env);
    return augmentBaseResponse(request, env, ctx);
  }
};
