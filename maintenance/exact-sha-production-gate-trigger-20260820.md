# Exact-SHA maintenance production gate trigger — 2026-08-20

This marker changes no Worker runtime behavior. It exists only so one commit SHA can first receive an exact-head non-production Cloudflare preview receipt and then, after a protected non-forced fast-forward of `main`, receive the production maintenance runtime-gate execution on that same SHA.

The already-merged production gate remains unchanged: shared fail-closed validation, ephemeral maintenance candidate deploy, guarded read-only `AI_GATEWAY_CONTROL -> admin-worker:AIGatewayControl` `routes.list` runtime E2E using Wrangler's actual deployed URL, clean final deploy, and automatic rollback on failure. No Dynamic Route mutation and no Expert call are introduced by this marker.
