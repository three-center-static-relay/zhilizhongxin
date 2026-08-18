# Governance compatible-CWD canary from admin scope

- Date: 2026-08-18
- Changed scope: `admin/*` only
- Expected: `admin-worker` completes its dry-run; `governance-worker` should be skipped by its watch path.
- If governance is nevertheless triggered, its conditional current-directory command must no longer fail.
- Safety: documentation-only; no merge, production deployment, route, secret, binding, or Durable Object state change.
