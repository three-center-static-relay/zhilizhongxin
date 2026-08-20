export function createEvolutionController({ inspect, propose, test, promote } = {}) {
  return async function evolve(systemState = {}) {
    const inspection = await inspect(systemState);
    const proposal = await propose({ systemState, inspection });
    const result = await test({ systemState, proposal });

    if (!result.ok) {
      return {
        status: "blocked",
        proposal,
        result,
        fail_closed: true
      };
    }

    const promotion = await promote({ proposal, result });

    return {
      status: "promoted",
      proposal,
      result,
      promotion
    };
  };
}
