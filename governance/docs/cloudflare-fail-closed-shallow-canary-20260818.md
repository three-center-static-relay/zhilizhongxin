# Fail-closed Cloudflare shallow-clone canary — governance scope

- Date: 2026-08-18
- Changed scope: `governance/*` only.
- Expected governance decision: `CF_PATH_SCOPE_ALLOWED` with exactly this file in `relevant_paths`.
- Expected admin decision: `CF_PATH_SCOPE_SKIPPED` with `changed_path_count: 1`.
- Both decisions must resolve the real parent of a depth-one clone.
- Expected maintenance result: no build because it remains disconnected.
- Safety: documentation-only; no merge, production deployment, route, secret, binding, or Durable Object state change.
