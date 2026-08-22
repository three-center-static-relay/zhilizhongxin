# Autonomic Maintenance v1

## Objective

Reduce maintenance time by separating fast service recovery from deep root-cause work. Governance owns policy and release authority. Cloudflare-native primitives execute the loop.

## Control loop

Detect -> Classify -> Mitigate -> Diagnose -> Repair -> Deterministic Validate -> Candidate -> Canary -> Promote or Rollback -> Learn.

## Runtime ownership

- Governance: policy, model selection, incident classification, release gate.
- Workers AI: free-first advisory reasoning.
- Workflows: durable maintenance state machine.
- Queues + DLQ: asynchronous incident buffering and repeated-failure isolation.
- Analytics Engine: health/incident telemetry.
- Durable Objects: strongly consistent operational state already present in Governance.
- AI Gateway / Expert model pool: model routing and fallback; OpenRouter remains a secondary pool.
- GitHub: source of truth and candidate changes.
- Codex: optional code-repair worker only after a verified code defect and failed simple patch. It is not the maintenance brain and has no production approval authority.

## Model policy

1. Routine: Cloudflare Workers AI `@cf/zai-org/glm-4.7-flash`.
2. Deep diagnosis: Cloudflare Workers AI `@cf/nvidia/nemotron-3-120b-a12b`.
3. Independent review: Cloudflare Workers AI `@cf/google/gemma-4-26b-a4b-it`.
4. OpenRouter: secondary dynamic candidate pool, selected by health/contracts/free-or-approved-budget policy.
5. Public leaderboards: discovery signal only; never direct production authority.
6. DeepSeek: eligible candidate when healthy and policy-compliant, never permanently pinned as the maintenance brain.

## Cost policy

- Default paid budget: USD 0.
- No automatic credit purchase.
- No automatic paid-model fallback.
- Free quota exhaustion degrades rather than spends.

## Safety

- Advisory models cannot browse or use tools.
- Repair model cannot self-approve.
- Production promotion requires deterministic tests, valid receipts, security pass, canary pass and rollback readiness.
- Security boundary, destructive data migration, privilege expansion and non-zero budget changes require higher-level approval.
