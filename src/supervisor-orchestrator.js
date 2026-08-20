export function createSupervisorGraph({ planner, executors, validator }) {
  return {
    async run(goal) {
      const plan = await planner(goal);
      const results = [];
      for (const step of plan.steps || []) {
        const executor = executors[step.executor];
        if (!executor) {
          results.push({ step, status: "blocked", reason: "executor_missing" });
          continue;
        }
        results.push(await executor(step));
      }
      const validation = await validator({ goal, plan, results });
      return {
        goal,
        plan,
        results,
        validation,
        next: validation.ok ? "promote" : "repair"
      };
    }
  };
}
