# Expert model candidate pool governance v2

## Purpose

Expert membership is no longer a fixed set of model companies. OpenRouter is the discovery marketplace; governance converts the live reasoning catalog into eight distinct company lanes, and Cloudflare AI Gateway Dynamic Routing chooses the concrete model for each task request. Expert Worker does not query OpenRouter during a live task.

## Discovery signals

The primary quality signal remains OpenRouter `intelligence-high-to-low`. Candidate refresh also reads:

- `latency-low-to-high`
- `throughput-high-to-low`
- `context-high-to-low`
- `pricing-low-to-high`
- `top-weekly`

All queries require `supported_parameters=reasoning` and text output.

## Hard filters

A model may enter the pool when it:

- supports reasoning and text output;
- is live/not expired;
- may be paid **or free**;
- may use a concrete `:free` variant;
- is not OpenAI;
- is not Anthropic / Claude;
- is not a Flash model;
- is not a synthetic/random router or ensemble wrapper.

`openrouter/free` is intentionally excluded from the auditable expert core because it can choose a free model dynamically without preserving a preassigned company lane. Specific free model IDs remain allowed.

## Dynamic company lanes

Governance keeps eight distinct company lanes (`lane-1` ... `lane-8`) rather than permanent `expert-1=CompanyA` assignments. On refresh, the highest-scoring eligible distinct companies are re-ranked and can occupy different lane numbers in the next route version.

Each lane retains several same-company candidates, including when available:

- quality-first model(s)
- balanced model(s)
- free model(s)
- lower-latency model(s)
- task-specialized reasoning candidates

Fallback must remain inside the same company lane so a failed model cannot silently collapse cross-company independence.

## Runtime division of responsibility

```text
OpenRouter multi-signal rankings
  -> governance filtering/scoring/company dedup
  -> eight candidate company lanes
  -> new Cloudflare Dynamic Route version
  -> Expert Worker task-specific panel architect
  -> 1-6 dynamic professions + 0-2 judges + 1-2 rounds
  -> unique lane allocation
  -> Cloudflare concrete-model routing and same-company fallback
  -> actual model/provider receipt verification
```

Cloudflare is the runtime routing/execution engine. Expert Worker remains responsible for cross-request orchestration because Dynamic Routing does not itself create an arbitrary number of separate expert calls or enforce cross-request company uniqueness.

## Runtime routing metadata

Cloudflare's five custom-metadata entries are used as:

- `stage`: planner / expert / judge / governance
- `lane`: distinct company lane
- `capability`: task-specific capability family
- `depth`: standard / deep
- `cost_mode`: free-first / balanced / quality-first

The expert's human-readable profession/title and mandate are generated dynamically for the task and remain in the model prompt; they are not frozen into the route graph.

## Free/paid adaptation

Free models are allowed, not universally preferred.

- routine/economy tasks may use `free-first`;
- ordinary tasks may use `balanced`;
- difficult or high-stakes tasks may use `quality-first`;
- all modes may fall back within the assigned company lane.

This makes cost behavior task-specific rather than a permanent global free-only or paid-only rule.

## Safe exploration and evolution

A candidate refresh creates a new route version. Production remains pinned until validation succeeds. Percentage split may be used only in an explicit exploration/canary mode and only between models inside the same company lane. Normal expert requests do not randomly A/B their final answer.

## Promotion checks

Before a new route version is promoted, verify:

1. eight distinct eligible company lanes exist;
2. free and paid model classification is correct;
3. no OpenAI / Anthropic / Claude / Flash / random-router candidate is present;
4. all model fallbacks remain same-company;
5. Cloudflare accepts the generated JSON route as valid;
6. planner can generate varying expert counts and task-specific professions;
7. one- and two-round panels execute;
8. actual `cf-aig-model` / `cf-aig-provider` receipts preserve company diversity;
9. previous route version remains available for rollback.
