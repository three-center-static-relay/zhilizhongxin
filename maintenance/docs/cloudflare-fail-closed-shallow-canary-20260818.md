# Fail-closed Cloudflare shallow-clone canary — maintenance scope

- Date: 2026-08-18
- Changed scope: `maintenance/*` only.
- Expected maintenance decision: `CF_PATH_SCOPE_ALLOWED` with exactly this file in `relevant_paths`, followed by syntax validation and Wrangler dry-run.
- Expected admin and governance decision: `CF_PATH_SCOPE_SKIPPED` with `changed_path_count: 1`.
- All decisions must resolve the real parent of a depth-one clone.
- Safety: documentation-only; no merge, production deployment, route, secret, binding, cron, queue, or Durable Object state change.
