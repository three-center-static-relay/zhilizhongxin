import base from "./index.js";
import { assistRoutingInfo, runAssist } from "./assist.js";
import { runFinalAssistValidation } from "./assist-final-validator.js";
import { assistRuntimeIdentity } from "./assist-runtime.js";

const POLICY_KERNEL_VERSION = "deterministic-v3";
const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function augmentAssistResponse(response) {
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object") return response;
  return json({ ...body, ...assistRuntimeIdentity() }, response.status);
}

async function augmentBaseResponse(request, env, ctx) {
  const response = await base.fetch(request, env, ctx);
  if (!response.ok) return response;
  const url = new URL(request.url);
  if (!new Set(["/health", "/v1/policy", "/policy", "/v1/capabilities", "/capabilities", "/v1/quota", "/quota", "/openapi.json"]).has(url.pathname)) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object") return response;
  const routing = assistRoutingInfo();
  const runtime = assistRuntimeIdentity();

  if (url.pathname === "/health") {
    return json({
      ...body,
      ai_assist: true,
      routing_mode: routing.mode,
      policy_kernel: POLICY_KERNEL_VERSION,
      fallback_selftests: true,
      final_output_validation: true,
      ...runtime
    });
  }

  if (url.pathname === "/v1/policy" || url.pathname === "/policy") {
    return json({
      ...body,
      policy: {
        ...(body.policy || {}),
        single_model_serial: true,
        parallel_models: false,
        cloudflare_free_first: true,
        openrouter_paid_only_fallback: true,
        web_gpt_final_fallback: true,
        web_gpt_final_output_must_be_revalidated: true,
        hard_rules_immutable: true,
        deterministic_policy_kernel: true,
        runtime_attestation: true
      },
      ...runtime
    });
  }

  if (url.pathname === "/v1/capabilities" || url.pathname === "/capabilities") {
    return json({
      ...body,
      capabilities: {
        ...(body.capabilities || {}),
        governance_ai_assist: true,
        workers_ai_random_failover: false,
        workers_ai_serial_failover: true,
        openrouter_paid_ranked_failover: true,
        web_gpt_final_fallback: true,
        deterministic_policy_kernel: true,
        model_output_contract_validation: true,
        authenticated_fallback_selftests: true,
        authenticated_final_output_validation: true,
        runtime_policy_attestation: true
      },
      ...runtime
    });
  }

  if (url.pathname === "/v1/quota" || url.pathname === "/quota") {
    return json({ ...body, ai_routing: routing, policy_kernel: POLICY_KERNEL_VERSION, ...runtime });
  }

  if (url.pathname === "/openapi.json") {
    return json({
      ...body,
      paths: {
        ...(body.paths || {}),
        "/v1/assist": {
          post: {
            summary: "Run authenticated governance AI assistance with deterministic hard-policy enforcement, serial model failover, and runtime policy attestation"
          }
        },
        "/v1/assist/validate": {
          post: {
            summary: "Validate a final governance answer against the same hard policy before it is accepted, including WebGPT final-fallback answers"
          }
        }
      },
      ...runtime
    });
  }

  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/assist") {
      return augmentAssistResponse(await runAssist(request, env));
    }
    if (request.method === "POST" && url.pathname === "/v1/assist/validate") {
      return runFinalAssistValidation(request, env);
    }
    return augmentBaseResponse(request, env, ctx);
  }
};
