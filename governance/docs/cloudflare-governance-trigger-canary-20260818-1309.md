# Governance Worker trigger canary

- Date: 2026-08-18
- Scope: `governance/*` only
- Purpose: verify the saved Cloudflare Workers Builds root, watch-path isolation, and non-production dry-run command.
- Safety: documentation-only; no runtime route, secret, binding, deployment, Durable Object migration, or production state is changed.
- Expected: only `governance-worker` starts; `admin-worker` and `maintenance-worker` remain idle.
