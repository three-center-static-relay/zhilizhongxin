export function createDeploymentLoop({ planner, executor, validator, repair }) {
  return async function runDeployment(goal) {
    const plan = await planner(goal);

    const execution = await executor(plan);

    const validation = await validator(execution);

    if (validation.ok) {
      return {
        status: "promoted",
        plan,
        execution,
        validation
      };
    }

    const repaired = await repair({ plan, execution, validation });

    return {
      status: "repair_required",
      plan,
      execution,
      validation,
      repaired
    };
  };
}
