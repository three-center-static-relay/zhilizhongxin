# Expert V4.1 control-plane acceptance — 2026-08-20

Current isolation request: `expert-v4.1-deploy-only-admin-binding-20260820`.

The previous real-deployed diagnostic combined four variables: disposable Worker deployment, workers.dev invocation, Service Binding execution, and cleanup. It failed, so this revision removes execution entirely and tests only whether Cloudflare accepts a real deployed disposable Worker that declares a default Service Binding to existing `admin-worker`, followed by cleanup.

Path under test:
`Wrangler authenticated deploy -> disposable Worker configuration containing ADMIN_DEFAULT -> admin-worker`.

The diagnostic Worker itself does not invoke the binding in this revision. Therefore:
- PASS proves the real account accepts deployment of a caller Worker with a Service Binding targeting `admin-worker`, and cleanup succeeds;
- FAIL means the blocker is already in disposable deployment/binding configuration/cleanup and is below any runtime HTTP/RPC/AI Gateway call.

Safety invariants:
- commit-derived `l2-admin-bind-*` diagnostic name;
- `WRANGLER_CI_OVERRIDE_NAME` removed before nested deploy/delete;
- only the disposable diagnostic Worker may be created/deleted;
- `binding_execution:false`;
- `production_worker_mutated:false`;
- `production_worker_traffic_changed:false`;
- `dynamic_route_mutation:false`;
- no named `AIGatewayControl`, no AI Gateway, no Expert call, no secret output.

If deploy-only PASSes, the next isolated test will deploy the same kind of disposable Worker and call its own public `/health` without using the Service Binding. Only after public invocation is proven will binding execution be restored. This separates deployment, caller reachability, and Service Binding runtime semantics into independent gates.

Expert #43 remains the sole clean replacement. Exact head `072c95de9caec0227d7388e3237bfe8146634f19` has candidate Build `8084070e-1935-4dc2-86ea-37a4229e7514` = PASS; this is candidate proof only.
