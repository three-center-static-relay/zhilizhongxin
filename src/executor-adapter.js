export function createExecutorAdapter({ github, cloudflare, providers = {} } = {}) {
  return {
    async execute(target, payload = {}) {
      const executor = providers[target];
      if (!executor) {
        return {
          ok: false,
          status: "blocked",
          reason: "EXECUTOR_NOT_REGISTERED",
          target
        };
      }
      return executor(payload);
    },
    availableTargets() {
      return Object.keys(providers);
    }
  };
}
