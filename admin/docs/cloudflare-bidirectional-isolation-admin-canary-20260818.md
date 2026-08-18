# Bidirectional isolation canary: admin

- Date: 2026-08-18
- Changed scope: `admin/*` only
- Expected: `admin-worker` completes its dry-run; `governance-worker` and `maintenance-worker` do not start.
- Safety: documentation-only; no merge, production deployment, route, secret, binding, or Durable Object state change.
