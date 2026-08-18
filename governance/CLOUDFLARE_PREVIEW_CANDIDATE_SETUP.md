# Cloudflare Candidate Dry-Run Setup

Status: Phase 2 source contract. This document contains no secret values.

## Purpose

`createCandidateVersion` asks Cloudflare Workers Builds to validate four exact Git commits through each Worker's non-production dry-run trigger. It does not upload a Worker version and must not change production traffic.

The four candidate Workers are:

- `governance-worker`
- `intelligence-worker`
- `compute-worker`
- `expert-worker`

The gateway triggers them strictly serially. A failure stops the chain. Already-triggered partial builds are cancelled best-effort.

## Required governance-worker runtime configuration

Configure these only in Cloudflare, never in Git or the GPT Action schema:

- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account identifier. Non-secret runtime variable is acceptable.
- `CLOUDFLARE_BUILDS_API_TOKEN` — secret user-scoped API token used only by the governance Worker to call the Workers Builds API.

The API token is not the Workers Builds deployment/build token. It is the token used by the governance Worker to call the Cloudflare API.

Current Cloudflare Workers Builds documentation requires a **user-scoped API token** for the Builds API. The documented permissions for this workflow are:

- Workers Builds Configuration: Edit
- Workers Scripts: Read

Use the narrowest account/resource scope that covers the four Workers. Do not store or echo the token in GitHub, Action JSON, logs, receipts, or model prompts.

## Dry-run trigger invariant

Each of the four Workers must have a non-production/preview trigger with all of the following properties:

- `main` is excluded from the trigger.
- deploy command is exactly `npm run cf:build && npx wrangler deploy --dry-run`.
- the trigger is connected to the correct Git repository.
- the trigger can build the requested non-main candidate branch and exact commit.

The Admin Gateway rejects a trigger that does not satisfy these invariants. A production trigger using `wrangler deploy` without `--dry-run` is never selected by `createCandidateVersion`.

## Candidate request contract

The GPT Action must provide a non-main branch and the exact 40-hex Git SHA for every center:

```json
{
  "branch": "candidate/example",
  "commits": {
    "governance": "<40-hex-sha>",
    "intelligence": "<40-hex-sha>",
    "compute": "<40-hex-sha>",
    "expert": "<40-hex-sha>"
  },
  "label": "optional",
  "reason": "optional"
}
```

A successful trigger returns HTTP 202 with `candidate_kind=cloudflare-dry-run-build-set`, four `build_uuid` values, `candidate_digest`, `run_id`, and `receipt_digest`.

## Validation scope

`validateCandidate` polls the four build UUIDs and verifies:

1. candidate manifest digest
2. all builds terminal
3. all builds successful
4. exact branch identity
5. exact commit identity
6. exact non-mutating `wrangler deploy --dry-run` command
7. four-center context completeness
8. center health
9. production runtime metadata availability
10. active-state visibility
11. centers idle
12. production runtime versions unchanged while candidate builds ran
13. production source digests unchanged while candidate builds ran

If a build is still running, validation returns HTTP 202 with `validation=PENDING` and does not create a terminal acceptance run.

Terminal PASS/FAIL produces an immutable acceptance receipt with `run_id` and `receipt_digest`.

## Important limitation: not runtime business E2E

Phase 2 proves the candidate **build/control-plane** chain only. It does not claim fresh candidate runtime business E2E, and therefore:

- `fresh_business_e2e=false`
- `promotion_eligible=false`
- `promoteCandidate` is not exposed
- `rollbackProduction` is not exposed

Cloudflare does not generate Preview URLs for Workers that implement Durable Objects. Because the current intelligence, compute, expert, and governance architecture uses Durable Objects, and the dry run uploads no version, build success cannot be treated as a candidate runtime E2E result.

A later phase must introduce an isolated runtime-canary mechanism before production promotion is enabled.

## Fail-closed behavior

- Missing account ID or Builds API token -> 503, no fake candidate.
- `main` branch -> 400.
- malformed or missing commit SHA -> 400.
- active downstream task -> 409, no build trigger.
- no safe dry-run trigger -> 503, no production trigger fallback.
- partial trigger failure -> stop and cancel already-triggered builds best-effort.
- AdminState persistence failure after triggering -> cancel the triggered build set best-effort and return failure.
- any terminal build failure or identity mismatch -> acceptance FAIL (422).
- production version/source drift during validation -> acceptance FAIL (422).

## Production activation checklist

Before attempting a live candidate:

- [ ] All four latest Worker builds are deployed and Phase 1 read-only Admin Actions return real receipts.
- [ ] `CLOUDFLARE_ACCOUNT_ID` is configured on `governance-worker`.
- [ ] `CLOUDFLARE_BUILDS_API_TOKEN` is configured as a Cloudflare secret on `governance-worker`.
- [ ] The token is user-scoped and limited to the required permissions/resources.
- [ ] All four Workers have a non-production trigger that excludes `main` and uses `npm run cf:build && npx wrangler deploy --dry-run`.
- [ ] GPT Action schema has been refreshed from the latest `/openapi.json` and shows 10 operations.
- [ ] `promoteCandidate` and `rollbackProduction` are absent.
- [ ] A first live candidate is created with a disposable non-main candidate branch and known exact commit SHAs.
