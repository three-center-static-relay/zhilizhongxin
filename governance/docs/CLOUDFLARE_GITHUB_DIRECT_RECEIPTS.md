# Cloudflare → GitHub direct build receipts

## Goal

Publish a redacted terminal Cloudflare Workers Build receipt directly onto the exact Git commit as a GitHub Commit Status. This removes dependence on delayed pull-request bot comments and does not use GitHub Actions.

## Security boundary

Cloudflare receives one dedicated secret:

`GITHUB_COMMIT_STATUS_TOKEN`

The token must be a fine-grained GitHub token scoped only to the repositories that need receipts, with repository permission:

- **Commit statuses: Read and write**

Do **not** grant Contents, Issues, Pull requests, Actions, Administration, Secrets, or Workflows permissions.

The token is never written into source, status descriptions, failure payloads, or logs.

## Status contract

Contexts:

- `cloudflare/admin`
- `cloudflare/governance`
- `cloudflare/maintenance`
- other repositories can reuse the same publisher with their worker scope

States:

- `pending` — Cloudflare build wrapper started
- `success` — wrapped build command exited 0
- `failure` — wrapped build command exited non-zero

Description is bounded and redacted:

`PASS|RUN|FAIL <mode> <last phase/code> b=<build UUID prefix> d=<receipt digest>`

The digest is SHA-256 over non-secret receipt metadata. `WORKERS_CI_COMMIT_SHA`, `WORKERS_CI_BUILD_UUID`, and `WORKERS_CI_BRANCH` come from Cloudflare Workers Builds.

## Failure isolation

Receipt publication is **observability fail-open**:

- if GitHub status publication fails or the token is absent, the actual Cloudflare build result remains authoritative;
- a receipt transport failure cannot convert a valid production build into a false FAIL;
- the build log emits a redacted `CLOUDFLARE_GITHUB_STATUS` diagnostic so the missing receipt can be distinguished from a business-gate failure.

Business gates remain fail-closed.

## Cloudflare configuration

Add `GITHUB_COMMIT_STATUS_TOKEN` to the Workers Builds environment as a secret for each project that should publish receipts.

Optional:

- `GITHUB_RECEIPT_REPOSITORY=three-center-static-relay/zhilizhongxin` if Git remote inference is not desired.
- `CLOUDFLARE_ACCOUNT_ID` enables a clickable build-log target URL in the commit status.
- `CLOUDFLARE_RECEIPT_WORKER_NAME` overrides the default `<scope>-worker` target.

## Read path

The controller reads the exact SHA through GitHub's combined commit-status endpoint. No PR-comment synchronization is required.

Final PASS is still never inferred from absence, delay, static code, or a different SHA.
