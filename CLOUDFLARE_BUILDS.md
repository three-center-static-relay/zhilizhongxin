# Cloudflare Workers Builds contract

This repository is a three-Worker monorepo. Cloudflare Dashboard settings are deployment state and are not read from Git. Apply this matrix separately to each Worker under **Settings > Build**.

Cloudflare Workers Builds currently ignores Wrangler custom-build configuration. For that reason, no Worker relies on `wrangler.jsonc` `build.command`; the dashboard deploy command invokes the repository gate explicitly.

| Worker | Root directory | Build watch include | Production branch | Build command | Production deploy command | Non-production deploy command |
|---|---|---|---|---|---|---|
| `governance-worker` | `governance` | `governance/*` | `main` | empty | `npm run cf:build && npx wrangler deploy` | `npm run cf:build && npx wrangler deploy --dry-run` |
| `admin-worker` | `admin` | `admin/*` | `main` | empty | `npm run cf:build && npx wrangler deploy` | `npm run cf:build && npx wrangler deploy --dry-run` |
| `maintenance-worker` | `maintenance` | `maintenance/*` | `main` | empty | `npm run cf:build && npx wrangler deploy` | `npm run cf:build && npx wrangler deploy --dry-run` |

Branch rules:

- production builds: include `main`;
- non-production builds: include `*`, exclude `main`;
- build watch excludes: empty.

The commands deliberately use the exact Wrangler version pinned in `package.json`. `cf:preview` is a build-and-package validation only: it performs no remote upload and cannot alter traffic. This is required because these Workers declare top-level Durable Object `exports`; Cloudflare rejects `wrangler versions upload` for that lifecycle model. `cf:deploy` remains the only production mutation command.

Do not treat a dry run as a runtime preview. Runtime staging requires separately provisioned staging Worker names, Durable Object namespaces, service bindings, secrets, and routes. Add `--env staging` only after that Cloudflare account state has been audited; never point a staging binding at a production Durable Object namespace.

## Acceptance

1. Save the settings for all three Workers.
2. Push a non-main commit that changes only `governance/*`.
3. Confirm Cloudflare creates exactly one build for `governance-worker`; `admin-worker` and `maintenance-worker` must not run.
4. Confirm the log runs `npm run cf:build` before Wrangler.
5. Confirm the non-production build completes `wrangler deploy --dry-run` and performs no remote upload.
6. Merge only after the Cloudflare check succeeds.

These Workers use Durable Objects, so the absence of a preview URL is expected. A successful dry run proves packaging and configuration validity only, not runtime business E2E behavior.

References: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/), and [build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).
