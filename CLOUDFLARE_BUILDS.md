# Cloudflare Workers Builds contract

This repository is a three-Worker monorepo. Cloudflare Dashboard settings are deployment state and are not read from Git. Apply this matrix separately to each Worker under **Settings > Build**.

Cloudflare Workers Builds currently ignores Wrangler custom-build configuration. For that reason, no Worker relies on `wrangler.jsonc` `build.command`; the dashboard deploy command invokes the repository gate explicitly.

| Worker | Root directory | Build watch include | Production branch | Build command | Production deploy command | Non-production deploy command |
|---|---|---|---|---|---|---|
| `governance-worker` | `governance` | `governance/*` | `main` | empty | `npm run cf:build && npx wrangler deploy` | `npm run cf:build && npx wrangler versions upload` |
| `admin-worker` | `admin` | `admin/*` | `main` | empty | `npm run cf:build && npx wrangler deploy` | `npm run cf:build && npx wrangler versions upload` |
| `maintenance-worker` | `maintenance` | `maintenance/*` | `main` | empty | `npm run cf:build && npx wrangler deploy` | `npm run cf:build && npx wrangler versions upload` |

Branch rules:

- production builds: include `main`;
- non-production builds: include `*`, exclude `main`;
- build watch excludes: empty.

The commands deliberately use the Wrangler binary installed from `package.json`; they do not fetch a floating CLI at deploy time. `cf:preview` and `cf:deploy` remain equivalent local/manual conveniences, while the dashboard command is written out so the Governance candidate controller can verify that preview builds end in `wrangler versions upload`.

## Acceptance

1. Save the settings for all three Workers.
2. Push a non-main commit that changes only `governance/*`.
3. Confirm Cloudflare creates exactly one build for `governance-worker`; `admin-worker` and `maintenance-worker` must not run.
4. Confirm the log runs `npm run cf:build` before Wrangler.
5. Confirm the preview build uploads a version and does not change production traffic.
6. Merge only after the Cloudflare check succeeds.

These Workers use Durable Objects, so the absence of a preview URL is expected. A successful version upload is a control-plane result, not a runtime business E2E result.

References: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/), and [build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).
