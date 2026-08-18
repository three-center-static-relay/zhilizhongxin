# Phase 3 Runtime Canary Design

Status: DESIGN-LOCKED / NOT ENABLED

This phase must not be implemented as a production mutation until Phase 2 has produced a real Cloudflare build receipt in production and a stable post-`ADMIN_STATE` Durable Object baseline exists.

## Why Phase 3 is separate

Phase 2 proves that four exact Git commits pass the repository gate and `wrangler deploy --dry-run`. It intentionally uploads no Worker version. Build success is necessary but is not fresh business runtime E2E.

The current Workers use Durable Objects. Cloudflare does not generate Preview URLs for Workers that implement Durable Objects, so candidate runtime testing cannot rely on normal preview URLs.

Runtime canary therefore requires a separately provisioned staging topology. Reusing a production Durable Object namespace, service binding, secret, queue, workflow, route, or storage bucket would invalidate isolation and is forbidden.

## Required sequence

Phase 3 must use the following strict order for each candidate set:

1. Phase 2 `createCandidateVersion` triggers four exact dry-run builds.
2. Phase 2 `validateCandidate` reaches terminal PASS.
3. Verify a staging manifest maps every center to a distinct staging Worker name and distinct stateful resource identifiers.
4. Re-read current production versions and source digests. Abort if they drifted from the candidate baseline.
5. Verify all production task locks are visible and idle; staging must use independent locks.
6. Deploy the exact commits to the isolated staging topology through a protected `wrangler deploy --env staging` path.
7. Attest each staging response against the expected Git commit, Worker version metadata, environment name, and source digest.
8. Run center-specific bounded business E2E only against staging routes/service bindings.
9. On any canary failure, stop the staging test, retain the failure receipt, and leave production untouched.
10. Only after all required center canaries PASS may a candidate become `promotion_eligible=true`.
11. Promotion remains a separate explicit operation; no canary endpoint may promote implicitly.

## Reliable staging identity capture

Do not infer identity from timestamps or "latest version" ordering.

Cloudflare Workers Builds injects these build environment variables:

- `WORKERS_CI_BUILD_UUID`
- `WORKERS_CI_COMMIT_SHA`
- `WORKERS_CI_BRANCH`

Wrangler supports structured command output through `WRANGLER_OUTPUT_FILE_PATH` / `WRANGLER_OUTPUT_FILE_DIRECTORY`. The protected staging deployment wrapper must retain bounded structured output and the staging Worker version ID.

Before Phase 3 is enabled, each staging deployment should use a deterministic wrapper that:

1. sets a Wrangler structured output file path;
2. runs `npm run cf:build && npx wrangler deploy --env staging` against an audited staging configuration;
3. emits only bounded deployment identity records into the protected build log;
4. proves that every stateful binding resolves to a staging resource and leaves production traffic/state unchanged.

The Admin Gateway can then fetch the build log by `build_uuid`, parse the structured record, and require all of these identities to agree:

- build UUID
- branch
- Git commit SHA
- Worker name/tag
- uploaded Worker version ID

If the structured identity record is absent, duplicated, malformed, inconsistent, or points to a production resource, candidate runtime canary must remain `NOT_VERIFIABLE`.

## Canary request invariant

Every canary must target an allowlisted staging hostname or staging service binding and must return or internally attest the same staging identity through `CF_VERSION_METADATA`, source digest, and environment metadata. A 200 response from a production Worker, wrong commit, or wrong state namespace is a FAIL.

## Center-specific minimum canary

### Governance

- runtime attestation
- Action/OpenAPI shape
- admin read receipt
- auxiliary zero-tool/cancel contract using deterministic or bounded model behavior

### Intelligence

- health/source identity
- one bounded public-zero-key business E2E
- lock acquire/release correctness
- no secret echo

### Compute

- health/source identity
- control-plane selftest first
- a bounded CPU lifecycle canary before any T4 canary
- T4 canary only after CPU PASS and within the configured compute budget
- lock and temporary-resource cleanup evidence

### Expert

- health/source identity
- zero-tool invariant
- paid OpenRouter call only when explicitly included in the acceptance plan
- strict serial model execution and bounded timeout

## Durable Object and rollback caution

The governance Worker now includes the `ADMIN_STATE` Durable Object class. Cloudflare rollback has restrictions when a Durable Object class lifecycle change occurred between versions. Therefore the system must first establish a new verified-stable baseline after the `ADMIN_STATE` deployment before automatic rollback is enabled.

Until that baseline is proven:

- `promoteCandidate`: disabled
- `rollbackProduction`: disabled
- automatic rollback: disabled
- production mutation actions exposed to GPT: zero

## Proposed Phase 3 receipts

A future successful canary receipt must contain at least:

```json
{
  "receipt_schema": "three-center-runtime-canary-receipt-v1",
  "run_id": "canary-...",
  "candidate_id": "candidate-...",
  "candidate_digest": "...",
  "center": "compute",
  "candidate_version_id": "...",
  "stable_version_id": "...",
  "deployment_before": "...",
  "deployment_canary": "...",
  "override_attested": true,
  "business_e2e": true,
  "validation": "PASS",
  "cleanup_verified": true,
  "production_normal_traffic_to_candidate": 0,
  "receipt_digest": "..."
}
```

No field may be marked PASS without a real Cloudflare deployment/version response and a real runtime receipt.

## Enablement gates

Do not implement or expose a Phase 3 mutation Action until all are true:

- [ ] Phase 1 live Admin receipts are VERIFIED/COMPLETE as appropriate.
- [ ] Phase 2 live candidate build can be created and reaches terminal PASS.
- [ ] Candidate Worker version IDs are captured deterministically, not inferred.
- [ ] The current `ADMIN_STATE` Durable Object version has been deployed and established as a verified stable rollback baseline.
- [ ] A 0%-traffic deployment mutation has an explicit tested restore path.
- [ ] Version Override response identity is proven with `CF_VERSION_METADATA`.
- [ ] Candidate removal/restore is idempotent and fail-closed.
- [ ] No promote or rollback operation can be reached from a Phase 3 canary failure path except the bounded restore-to-baseline action.
