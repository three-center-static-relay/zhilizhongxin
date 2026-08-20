export function createRollbackController({ validator } = {}) {
  return {
    async evaluate(result) {
      if (result?.ok === true) {
        return { action: "continue", status: "healthy" };
      }

      return {
        action: "rollback",
        status: "blocked",
        reason: "VALIDATION_FAILED",
        validator: Boolean(validator)
      };
    }
  };
}
