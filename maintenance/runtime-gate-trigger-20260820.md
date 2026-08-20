# Maintenance runtime broker production-gate trigger — 2026-08-20

This marker intentionally changes no Worker runtime behavior. Its only purpose is to obtain a fresh production-branch execution of the already-merged maintenance `cf:ci:deploy` runtime broker gate after a matching non-production preview passes.

The existing gate remains unchanged: shared fail-closed validation, ephemeral maintenance candidate deploy, guarded runtime `AI_GATEWAY_CONTROL -> admin-worker:AIGatewayControl` read-only `routes.list` E2E, clean final deploy, and automatic rollback on failure. No Dynamic Route mutation and no Expert call are introduced by this marker.
