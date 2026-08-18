# Cloudflare build settings verification

- Verification date: 2026-08-18
- Scope: `governance-worker` only
- Expected root directory: `governance`
- Expected watch path: `governance/**`
- Expected non-production command: `npm run cf:build && npx wrangler deploy --dry-run`
- Production mutation: forbidden
- Purpose: verify the saved Cloudflare Dashboard build settings after the granular audit in PR #47.

A correct result updates only the governance-worker build status for this commit. The admin-worker and maintenance-worker statuses must remain unchanged.
