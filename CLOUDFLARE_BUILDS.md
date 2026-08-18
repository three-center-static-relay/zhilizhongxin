# Cloudflare Workers Builds contract

This repository is a three-Worker monorepo. Cloudflare Dashboard settings are deployment state and are not read from Git. Apply this matrix separately under **Workers & Pages > Worker > Settings > Build**.

Cloudflare's build-watch filter is the first line of isolation. Because the connected build has demonstrably started `governance-worker` for an `admin/*`-only commit, every dashboard deploy command must also invoke the repository's fail-closed path gate. The gate is the authoritative containment control: an unrelated build envelope may still initialize, but it exits before Worker tests, Wrangler, upload, or deployment.

## Dashboard values

Use `/` as the canonical Root directory. The conditional command also tolerates Cloudflare starting in the package directory, which makes it safe against the observed effective-CWD inconsistency.

| Worker | Build watch include | Production branch | Production deploy command | Non-production deploy command |
|---|---|---|---|---|
| `governance-worker` | `governance/*` | `main` | `if [ -f governance/package.json ]; then cd governance; fi; npm run cf:ci:deploy` | `if [ -f governance/package.json ]; then cd governance; fi; npm run cf:ci:preview` |
| `admin-worker` | `admin/*` | `main` | `if [ -f admin/package.json ]; then cd admin; fi; npm run cf:ci:deploy` | `if [ -f admin/package.json ]; then cd admin; fi; npm run cf:ci:preview` |
| `maintenance-worker` | `maintenance/*` | `main` | `if [ -f maintenance/package.json ]; then cd maintenance; fi; npm run cf:ci:deploy` | `if [ -f maintenance/package.json ]; then cd maintenance; fi; npm run cf:ci:preview` |

Also set:

- Build command: empty.
- Non-production branches: include `*`, exclude `main`.
- Build watch excludes: empty. If the UI shows `node_modules/**` or `.git/` after clearing, treat them as harmless defaults/placeholders; do not add a cross-Worker source path.
- Wrangler: keep the exact version pinned in each package (`4.123.0`); do not use a floating range.

Keep `maintenance-worker` disconnected until both directions of the connected-worker canary pass.

## Fail-closed contract

`scripts/cloudflare-worker-gate.mjs` requires Cloudflare's injected `WORKERS_CI`, `WORKERS_CI_COMMIT_SHA`, and `WORKERS_CI_BRANCH` values. It then:

1. rejects missing/invalid CI context;
2. permits `deploy` only on `main` and permits `preview` only off `main`;
3. computes the changed paths for the current commit;
4. exits successfully with `CF_PATH_SCOPE_SKIPPED` when no path belongs to that Worker;
5. otherwise verifies the package identity and exact Wrangler pin, runs `cf:build`, and invokes the exact Wrangler version;
6. adds `--dry-run` for non-production, so no remote upload or traffic mutation occurs.

Changes to `.npmrc` or the gate and its test are shared build-control changes and therefore intentionally validate every connected Worker. Direct multi-commit pushes to `main` are prohibited: production changes must arrive through a reviewed squash or merge commit so the current commit is a complete auditable change boundary.

The ordinary `cf:preview` and `cf:deploy` scripts remain for explicit local operator use. Cloudflare Dashboard must use only `cf:ci:preview` and `cf:ci:deploy`.

## Acceptance

1. Save the guarded commands for `admin-worker` and `governance-worker`; leave `maintenance-worker` disconnected.
2. Push a non-main commit changing only `admin/*`.
3. In `admin-worker`, require `CF_PATH_SCOPE_ALLOWED`, all tests passing, and a successful Wrangler dry run.
4. If `governance-worker` is also initialized, require `CF_PATH_SCOPE_SKIPPED` and verify that neither `npm run cf:build` nor Wrangler runs afterward.
5. Repeat in the opposite direction with a `governance/*`-only commit.
6. Only after both directions pass, connect `maintenance-worker` with the guarded commands and run a `maintenance/*`-only canary.
7. Keep the pull request in Draft and do not merge until all three results are recorded.

A skipped envelope still consumes Cloudflare build initialization time. Eliminating that envelope requires Cloudflare's build-watch setting to behave correctly (or splitting the monorepo); the repository gate prevents cross-Worker execution and deployment, not provider-side initialization.

These Workers use Durable Objects, so the absence of a preview URL is expected. A successful dry run proves packaging and configuration validity only, not runtime business E2E behavior.

References: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/), [build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/), and [Workers Builds default environment variables](https://developers.cloudflare.com/changelog/post/2025-06-10-default-env-vars/).
