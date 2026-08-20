# Expert route L2 observable trigger — 2026-08-20

This audit-only marker intentionally triggers one maintenance preview after PR #94 already exists.

Current Phase-1 trigger request: `pr94-retrigger-predeploy-20260820-0752`.

The acceptance implementation is unchanged. The maintenance preview must run the existing fail-closed dry-run gate first, then execute the local candidate L2 route-family acceptance.

Phase 1 (`predeploy-control-plane`) PASS requires exactly eight Dynamic Routes, eight distinct company lanes, real route/version creation and deployment, previous-version → candidate-version rollback rehearsal, `dynamic_routes_deployed:true`, `rollback_rehearsal_ok:true`, `worker_deployment_mutated:false`, and `production_worker_traffic_changed:false`. Runtime Expert self-test is intentionally not counted as Phase-1 proof.

Phase 2 (`postdeploy-runtime`) is run only after the new Expert runtime is deployed and repeats the route/control-plane contract plus a real Expert `/v1/run` self-test requiring runtime success and company diversity.

This marker changes audit text only; it does not change route policy, model selection, Service Bindings, credentials, or production Worker traffic.
