# Expert route L2 observable trigger — 2026-08-20

This audit-only marker intentionally triggers one maintenance preview after PR #94 already exists.

Current diagnostic request: `pr94-broker-readonly-direct-wrangler-20260820-0944`.

The maintenance preview is temporarily in **read-only broker diagnostic mode**. It runs `run-l2-broker-readonly-canary.mjs`, which starts one local Wrangler driver and calls the remote Service Binding `AI_GATEWAY_CONTROL -> admin-worker`, named entrypoint `AIGatewayControl`, using exactly one logical operation: `routes.list` with bounded request retries.

This revision changes only the Wrangler launcher: it invokes the repository-installed `node_modules/.bin/wrangler` binary directly instead of `npx --no-install wrangler`. The RPC operation, broker allowlist, credentials, route policy, retry bounds, and production traffic behavior are unchanged.

Diagnostic PASS proves the deployed named entrypoint, remote Service Binding/RPC path, and current AI Gateway route-read path are usable. Diagnostic FAIL keeps the blocker in local Wrangler startup / admin production refresh / named entrypoint availability / RPC binding / AI Gateway read permission or gateway configuration. This diagnostic is **not** Phase-1 acceptance.

Safety boundary: no Dynamic Route creation, no version creation, no Dynamic Route deployment, no rollback, no Expert runtime call, no production Worker traffic mutation, and no secret disclosure.

After the read path is proven, a separate undeployed write-authority canary may test `AI Gateway Write`; only after read/write diagnostics pass will the normal full `predeploy-control-plane` Phase-1 acceptance be restored. Full Phase 1 still requires exactly eight Dynamic Routes, eight distinct company lanes, real route/version creation and deployment, previous-route-version → candidate-version rollback rehearsal, `dynamic_routes_deployed:true`, `rollback_rehearsal_ok:true`, `worker_deployment_mutated:false`, and `production_worker_traffic_changed:false`. Runtime Expert self-test remains a Phase-2 criterion.
