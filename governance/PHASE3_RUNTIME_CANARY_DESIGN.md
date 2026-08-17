# Phase 3 Runtime Canary Design

Status: DESIGN-LOCKED / NOT ENABLED

This phase must not be implemented as a production mutation until Phase 2 has produced a real Cloudflare build receipt in production and a stable post-`ADMIN_STATE` Durable Object baseline exists.

## Why Phase 3 is separate

Phase 2 proves that four exact Git commits can be built through safe non-production Workers Builds triggers using `wrangler versions upload`. Build success is necessary but is not fresh business runtime E2E.

The current Workers use Durable Objects. Cloudflare does not generate Preview URLs for Workers that implement Durable Objects, so candidate runtime testing cannot rely on normal preview URLs.

Cloudflare Version Overrides can route a request to a specific Worker version, including a version assigned 0% normal traffic, but the target version must already be part of the Worker's current deployment. Adding a new 0% version to the current deployment is therefore a production deployment mutation even though normal traffic remains on the stable version.

## Required sequence

Phase 3 must use the following strict order for each candidate set:

1. Phase 2 `createCandidateVersion` triggers four exact preview builds.
2. Phase 2 `validateCandidate` reaches terminal PASS.
3. Resolve the immutable Cloudflare Worker `version_id` created by each successful preview build.
4. Re-read current production versions and source digests. Abort if they drifted from the candidate baseline.
5. Verify all downstream task locks are visible and idle.
6. Create a two-version deployment for the center under test:
   - current verified stable version: 100%
   - candidate version: 0%
7. Run only bounded canary requests with `Cloudflare-Workers-Version-Overrides` targeting the candidate version.
8. Every canary response must return/version-attest the expected `CF_VERSION_METADATA.id`.
9. Run center-specific business E2E under the override.
10. On any canary failure, remove the candidate from the deployment and restore the prior stable deployment before returning FAIL.
11. Only after all required center canaries PASS may a candidate become `promotion_eligible=true`.
12. Promotion remains a separate explicit operation; no canary endpoint may promote implicitly.

## Reliable candidate version ID capture

Do not infer a version ID from timestamps or "latest version" ordering.

Cloudflare Workers Builds injects these build environment variables:

- `WORKERS_CI_BUILD_UUID`
- `WORKERS_CI_COMMIT_SHA`
- `WORKERS_CI_BRANCH`

Wrangler supports structured command output through `WRANGLER_OUTPUT_FILE_PATH` / `WRANGLER_OUTPUT_FILE_DIRECTORY`. A `version-upload` record contains the uploaded Worker version ID.

Before Phase 3 is enabled, each preview trigger should be changed to a deterministic wrapper that:

1. sets a Wrangler structured output file path;
2. runs `npm run cf:build && npx wrangler versions upload`;
3. emits only the bounded structured `version-upload` record into the Workers Build log;
4. leaves production traffic unchanged.

The Admin Gateway can then fetch the build log by `build_uuid`, parse the structured record, and require all of these identities to agree:

- build UUID
- branch
- Git commit SHA
- Worker name/tag
- uploaded Worker version ID

If the structured version ID record is absent, duplicated, malformed, or inconsistent, candidate runtime canary must remain `NOT_VERIFIABLE`.

## Canary request invariant

For an HTTP fetch canary:

```text
Cloudflare-Workers-Version-Overrides: <worker-name>="<candidate-version-id>"
```

The response must prove the override was actually applied by returning or internally attesting the same version ID through `CF_VERSION_METADATA`.

A 200 response from the wrong version is a FAIL.

For service-binding calls, the override header may be attached to `fetch()` subrequests. RPC service-binding calls are not suitable because version override headers cannot be attached to RPC calls.

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
