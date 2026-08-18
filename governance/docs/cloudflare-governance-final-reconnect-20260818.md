# Governance Worker clean-reconnect validation

- Verification date: 2026-08-18
- Connected Worker: `governance-worker` only
- Expected effective root: `/governance/`
- Expected package path: `/opt/buildhome/repo/governance/package.json`
- Expected watch include: `governance/*`
- Expected preview command: `npm run cf:build && npx wrangler deploy --dry-run`
- Expected production mutation: none

Pass requires governance-worker success and no admin-worker or maintenance-worker build.
