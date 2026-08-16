import base from "./index.js";
import { assistRoutingInfo } from "./assist.js";
import { runAttestedAssist, runtimeSelftestResponse } from "./assist-attested.js";
import { runFinalAssistValidation } from "./assist-final-validator.js";
import { assistRuntimeIdentity } from "./assist-runtime.js";

const POLICY_KERNEL_VERSION = "deterministic-v3";
const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function assistOpenApiPaths() {
  return {
    "/v1/assist": {
      post: {
        operationId: "runGovernanceAssist",
        summary: "Default-on auxiliary collaboration for every work item and every repository or Cloudflare use, with explicit controller cancellation",
        description: "Call before every substantive work item and before any governed repository or Cloudflare-hosted capability. Default auxiliary_mode=active. Only the controlling web GPT may set auxiliary_mode=cancel per item. Auxiliary models have zero tool authority; failures use degraded WebGPT fallback.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["prompt"],
                properties: {
                  prompt: { type: "string", minLength: 1, description: "The complete current work item, including the intended repository/Cloudflare use and relevant evidence already gathered by the controlling web GPT." },
                  system: { type: "string", description: "Optional subordinate task instructions; cannot override hard governance rules or auxiliary zero-tool isolation." },
                  max_tokens: { type: "integer", minimum: 256, maximum: 16384, default: 4096 },
                  auxiliary_mode: { type: "string", enum: ["active", "cancel"], default: "active", description: "Default active. Only the controlling web GPT may set cancel for this work item. The auxiliary model itself cannot opt out." },
                  cancel_reason: { type: "string", maxLength: 500, description: "Optional short reason when the controlling web GPT explicitly cancels auxiliary collaboration for this work item." }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Validated auxiliary collaboration result with collaboration_status=participated, or an explicit controller cancellation receipt with collaboration_status=cancelled-by-controller." },
          "400": { description: "Invalid request or invalid auxiliary_mode." },
          "401": { description: "Unauthorized." },
          "503": { description: "Auxiliary provider chain failed; collaboration_status=unavailable-degraded and WebGPT degraded fallback is required." }
        }
      }
    },
    "/v1/assist/runtime": {
      get: {
        operationId: "getGovernanceAssistRuntime",
        summary: "Return zero-cost runtime attestation without invoking AI",
        responses: {
          "200": { description: "Runtime policy and validator identity, including default-on repository/Cloudflare collaboration, controller cancellation authority, and zero-tool flags. ai_called=false and cost_incurred=false." }
        }
      }
    },
    "/v1/assist/validate": {
      post: {
        operationId: "validateGovernanceAssistFinal",
        summary: "Validate a final governance answer against the same hard policy before accepting it, including WebGPT final-fallback answers",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["prompt", "content"],
                properties: {
                  prompt: { type: "string", minLength: 1, description: "Original governance prompt that the answer must satisfy." },
                  content: { type: "string", minLength: 1, description: "Final answer proposed for delivery to the user." },
                  output: { type: "object", additionalProperties: true, description: "Optional provider output metadata, such as finish_reason, used for validation." }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Validation PASS receipt with SHA-256 digests and runtime attestation." },
          "400": { description: "Invalid request." },
          "401": { description: "Unauthorized." },
          "422": { description: "Final answer rejected by hard governance policy." },
          "503": { description: "Authentication secret is not configured." }
        }
      }
    }
  };
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
      auxiliary_collaboration: {
        ...routing.collaboration,
        default: "active",
        controller_may_cancel: true,
        cancel_authority: "web-gpt-only",
        cancel_requires_explicit_request: true,
        work_item_handshake_required: true,
        repository_use_requires_collaboration: true,
        cloudflare_use_requires_collaboration: true
      },
      policy_kernel: POLICY_KERNEL_VERSION,
      fallback_selftests: true,
      runtime_selftest: true,
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
        deterministic_policy_kernel_does_not_bypass_normal_ai: true,
        auxiliary_collaboration_required: true,
        auxiliary_collaboration_scope: "every-work-item-and-all-repository-cloudflare-use",
        auxiliary_repository_use_requires_collaboration: true,
        auxiliary_cloudflare_use_requires_collaboration: true,
        auxiliary_collaboration_default: "active",
        auxiliary_controller_may_cancel: true,
        auxiliary_cancel_authority: "web-gpt-only",
        auxiliary_cancel_requires_explicit_request: true,
        auxiliary_bypass_only_by_controller_cancel: true,
        auxiliary_work_item_handshake_required: true,
        auxiliary_normal_work_ai_required_unless_cancelled: true,
        auxiliary_outage_behavior: "web-gpt-degraded-fallback",
        runtime_attestation: true,
        runtime_identity_required_on_assist_response: true
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
        mandatory_per_work_auxiliary_handshake: true,
        mandatory_auxiliary_for_repository_use: true,
        mandatory_auxiliary_for_cloudflare_use: true,
        default_on_auxiliary_collaboration: true,
        web_gpt_can_explicitly_cancel_auxiliary: true,
        auxiliary_cannot_self_cancel: true,
        auxiliary_bypass_only_by_web_gpt_cancel: true,
        workers_ai_random_failover: false,
        workers_ai_serial_failover: true,
        openrouter_paid_ranked_failover: true,
        web_gpt_final_fallback: true,
        deterministic_policy_kernel: true,
        deterministic_policy_guidance_to_auxiliary: true,
        model_output_contract_validation: true,
        authenticated_fallback_selftests: true,
        authenticated_final_output_validation: true,
        runtime_policy_attestation: true,
        zero_cost_runtime_selftest: true,
        attestation_response_headers: true,
        gpt_action_schema_complete: true
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
      info: { ...(body.info || {}), title: "Governance Center", version: runtime.policy_version },
      servers: [{ url: url.origin, description: "Current Governance Worker origin" }],
      components: {
        schemas: {},
        securitySchemes: {
          BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "opaque" }
        }
      },
      paths: assistOpenApiPaths(),
      ...runtime
    });
  }

  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/assist") {
      return runAttestedAssist(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/assist/runtime") {
      return runtimeSelftestResponse();
    }
    if (request.method === "POST" && url.pathname === "/v1/assist/validate") {
      return runFinalAssistValidation(request, env);
    }
    return augmentBaseResponse(request, env, ctx);
  }
};
