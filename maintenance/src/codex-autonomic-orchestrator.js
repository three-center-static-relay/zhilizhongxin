// Codex autonomic orchestration bridge.
// Keeps Codex execution behind governance and receipts.
import { createCodexRuntime } from './codex-runtime-adapter.js';

export function createAutonomicCodexBridge({ constitutionGate, modelResolver, receiptWriter }) {
  const codex = createCodexRuntime({
    constitutionGate,
    modelResolver,
    receiptWriter,
  });

  return {
    async diagnoseAndPrepare(task) {
      return codex.executeMaintenanceTask({
        ...task,
        mode: 'autonomic-maintenance',
        production_mutation: false,
      });
    },
  };
}

export async function runCodexAutonomicCycle(env = {}, task = {}) {
  const bridge = createAutonomicCodexBridge({
    constitutionGate: env.constitutionGate,
    modelResolver: env.modelResolver,
    receiptWriter: env.receiptWriter,
  });

  return bridge.diagnoseAndPrepare({
    ...task,
    mode: 'autonomic-maintenance',
    production_mutation: false,
  });
}
