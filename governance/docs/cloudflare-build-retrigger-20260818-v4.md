# Cloudflare governance reconnection verification — round 4

- Verification date: 2026-08-18
- Connected Worker: `governance-worker` only
- Expected effective root: `/governance/`
- Expected package path: `/opt/buildhome/repo/governance/package.json`
- Expected watch include: `governance/*`
- Expected preview command: `npm run cf:build && npx wrangler deploy --dry-run`
- Production mutation: forbidden

A correct result triggers only governance-worker and completes from the governance project directory.
