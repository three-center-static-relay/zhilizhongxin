import { runCodexAutonomicCycle } from "./codex-autonomic-orchestrator.js";

export async function runCodexMaintenanceCycle(env, context = {}) {
  return await runCodexAutonomicCycle(env, {
    trigger: context.trigger || "scheduled-maintenance",
    receipt: context.receipt || {},
    production_mutation: false,
    requires_constitution_gate: true,
    requires_receipt: true,
  });
}

export const CODEX_AUTONOMIC_POLICY = Object.freeze({
  role: "maintenance-infrastructure",
  production_mutation: false,
  constitution_required: true,
  receipt_required: true,
  model_priority: [
    "cloudflare-workers-ai-free-best",
    "open-model-market-reasoning-value-ranking",
    "fallback-candidates"
  ]
});
