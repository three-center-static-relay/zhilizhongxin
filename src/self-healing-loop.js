export function createSelfHealingLoop({ diagnose, repair, validate } = {}) {
  return async function heal(context = {}) {
    const diagnosis = await diagnose(context);

    if (diagnosis.ok) {
      return {
        status: "healthy",
        diagnosis
      };
    }

    const repairResult = await repair({ context, diagnosis });
    const validation = await validate({ context, repairResult });

    return {
      status: validation.ok ? "recovered" : "blocked",
      diagnosis,
      repair: repairResult,
      validation,
      fail_closed: !validation.ok
    };
  };
}
