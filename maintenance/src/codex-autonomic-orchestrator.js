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
