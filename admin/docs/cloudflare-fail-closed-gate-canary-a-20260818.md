# Fail-closed Cloudflare path gate canary — admin scope

- Date: 2026-08-18
- Changed scope: `admin/*` only
- Expected admin result: `CF_PATH_SCOPE_ALLOWED`, then build contract and Wrangler dry-run succeed.
- Expected governance result if its provider-side envelope starts: `CF_PATH_SCOPE_SKIPPED`, with no Worker tests or Wrangler afterward.
- Expected maintenance result: no build because the Worker remains disconnected.
- Safety: documentation-only; no merge, production deployment, route, secret, binding, or Durable Object state change.
