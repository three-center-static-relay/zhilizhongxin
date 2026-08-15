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
        summary: "Run authenticated governance AI assistance with hard-policy enforcement, serial failover, and runtime attestation",
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
                  prompt: { type: "string", minLength: 1, description: "Governance task or authenticated self-test prompt." },
                  system: { type: "string", description: "Optional subordinate task instructions; cannot override hard governance rules." },
                  max_tokens: { type: "integer", minimum: 256, maximum: 16384, default: 4096 }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Validated governance result with runtime attestation." },
          "400": { description: "Invalid request." },
          "401": { description: "Unauthorized." },
          "503": { description: "Provider chain failed or WebGPT final fallback is required." }
        }
      }
    },
    "/v1/assist/runtime": {
      get: {
        operationId: "getGovernanceAssistRuntime",
        summary: "Return zero-cost runtime attestation without invoking AI",
        responses: {
          "200": { description: "Runtime policy and validator identity. ai_called=false and cost_incurred=false." }
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
        workers_ai_random_failover: false,
        workers_ai_serial_failover: true,
        openrouter_paid_ranked_failover: true,
        web_gpt_final_fallback: true,
        deterministic_policy_kernel: true,
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
        ...(body.components || {}),
        securitySchemes: {
          ...(body.components?.securitySchemes || {}),
          BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "opaque" }
        }
      },
      paths: {
        ...(body.paths || {}),
        ...assistOpenApiPaths()
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