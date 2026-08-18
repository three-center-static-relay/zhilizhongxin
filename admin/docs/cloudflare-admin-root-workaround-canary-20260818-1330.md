# Admin Worker explicit-root canary

- Date: 2026-08-18
- Scope: `admin/*` only
- Purpose: verify Cloudflare Workers Builds with repository root `/` and an explicit `cd admin` non-production dry-run command.
- Safety: documentation-only; no runtime route, secret, binding, Durable Object migration, merge, or production state is changed.
- Expected: `admin-worker` completes its dry-run; unrelated Workers should be skipped by their watch paths.
