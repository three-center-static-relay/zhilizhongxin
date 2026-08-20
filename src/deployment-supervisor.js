export function createDeploymentSupervisor({
  planner,
  executors = {},
  validator,
  repair = async () => ({ repaired: false })
} = {}) {
  return {
    async run(goal) {
      const plan = await planner(goal);
      const results = [];

      for (const step of plan.steps ?? []) {
        const executor = executors[step.type];
        if (!executor) {
          results.push({ step, status: "blocked", reason: "executor_missing" });
          continue;
        }

        const result = await executor(step);
        results.push({ step, result });

        const check = await validator({ step, result });
        if (!check.ok) {
          const recovery = await repair({ step, result, check });
          results.push({ recovery });
        }
      }

      return {
        goal,
        results,
        status: results.every(r => !r.status || r.status !== "blocked") ? "completed" : "blocked"
      };
    }
  };
}
