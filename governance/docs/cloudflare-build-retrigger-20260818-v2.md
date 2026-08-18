# Cloudflare build settings verification — round 2

- Verification date: 2026-08-18
- Scope: `governance-worker` only
- Expected root directory: `governance`
- Expected watch include: `governance/*`
- Expected version command: `npm run cf:build && npx wrangler deploy --dry-run`
- Production mutation: forbidden
- Purpose: verify the re-saved Cloudflare Dashboard settings after screenshot review.

A correct result updates only the governance-worker build status for this commit. The admin-worker and maintenance-worker statuses must remain unchanged.
