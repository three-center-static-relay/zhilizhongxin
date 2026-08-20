# Expert V4.1 control-plane acceptance — 2026-08-20

Current isolation request: `expert-v4.1-real-deployed-admin-service-binding-20260820`.

The previous local/remote-development canaries were not sufficient to prove production Worker-to-Worker binding semantics. This revision deploys one disposable diagnostic caller Worker into the same Cloudflare account, binds it to the already-deployed `admin-worker` default Service Binding, calls only `GET https://admin.internal/health`, validates HTTP 200 + `ok:true`, and deletes the diagnostic caller in `finally`.

Path under test:
`real deployed disposable Worker -> ADMIN_DEFAULT Service Binding -> admin-worker default fetch -> /health`.

This test deliberately bypasses named `AIGatewayControl` and bypasses AI Gateway. A PASS therefore proves the real deployed Service Binding substrate independently of named RPC and AI Gateway permissions. A FAIL keeps the fault below the broker layer and directs the next investigation to Service Binding target/account/environment resolution.

Safety invariants:
- the disposable caller uses a commit-derived `l2-admin-probe-*` name;
- `WRANGLER_CI_OVERRIDE_NAME` is removed before nested Wrangler deploy/delete so `maintenance-worker` cannot be overwritten;
- only the diagnostic Worker is created/deleted;
- `production_worker_mutated:false`;
- `production_worker_traffic_changed:false`;
- `dynamic_route_mutation:false`;
- no Dynamic Route/version creation, deployment or rollback;
- no Expert call;
- no secret, header, route content or model content output.

The dedicated admin refresh PR #116 was merged through the existing Tencent fail-closed gate as governance main commit `5193ca8edaf703c30333395c522aa831766af9c5`. Its exact PR-head admin preview `fc04a8a1c655eea6153c7f193b1a24e6e7b00468` passed Build `e98b3d65-1717-44cf-a9d9-fa8eced91d18`; the real Service Binding test remains runtime evidence rather than treating preview green as production proof.

If this deployed default-binding canary passes, the next canary will use the same real deployed caller mechanism but bind specifically to `admin-worker:AIGatewayControl` and perform read-only `routes.list`. Only after default binding + named broker read are proven will an undeployed write-authority canary and full Phase 1 resume.

Expert #43 remains the sole clean replacement. Exact head `072c95de9caec0227d7388e3237bfe8146634f19` has candidate Build `8084070e-1935-4dc2-86ea-37a4229e7514` = PASS; this is candidate proof, not production deployment proof.
