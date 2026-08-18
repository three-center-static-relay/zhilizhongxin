# Fail-closed Cloudflare shallow-clone canary — admin scope v2

- Date: 2026-08-18
- Changed scope: `admin/*` only.
- Expected admin decision: `CF_PATH_SCOPE_ALLOWED` with exactly this file in `relevant_paths`.
- Expected governance decision: `CF_PATH_SCOPE_SKIPPED` with `changed_path_count: 1`.
- The gate must resolve the real parent of a depth-one clone; whole-tree fallback is forbidden.
- Safety: documentation-only; no merge, production deployment, route, secret, binding, or Durable Object state change.
