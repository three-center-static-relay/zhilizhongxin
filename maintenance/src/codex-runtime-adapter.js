// Codex SDK adapter foundation for Maintenance Center.
// This module intentionally does not bypass governance gates.

export function createCodexRuntime({ constitutionGate, modelResolver, receiptWriter }) {
  if (!constitutionGate || !modelResolver || !receiptWriter) {
    throw new Error('CODEX_RUNTIME_DEPENDENCIES_REQUIRED');
  }

  return {
    async executeMaintenanceTask(task) {
      const verdict = await constitutionGate({
        action: 'codex_maintenance_execution',
        task,
      });

      if (!verdict?.pass) {
        throw new Error('CODEX_CONSTITUTION_GATE_DENIED');
      }

      const model = await modelResolver({
        priority: [
          'cloudflare_workers_ai_free_best',
          'open_model_market_reasoning_value_rank',
          'fallback_candidates',
        ],
      });

      const receipt = {
        component: 'codex-runtime',
        model,
        task_id: task?.id ?? null,
        constitution_gate_pass: true,
      };

      await receiptWriter(receipt);
      return receipt;
    },
  };
}
