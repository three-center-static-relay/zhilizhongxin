# Expert V4.1 control-plane acceptance — 2026-08-20

This maintenance scope belongs only to the clean Expert V4.1 Cloudflare control plane. It is layered on the current governance main and must not restore stale Expert or China-compute history.

Current observable preflight request: `expert-v4.1-clean-broker-read-observable-20260820-1027`.

The preview first runs static V4.1 contracts and a read-only broker canary:
`local Wrangler driver -> AI_GATEWAY_CONTROL -> admin-worker:AIGatewayControl -> routes.list`.

Read preflight safety: no route/version creation, deployment, rollback, Expert call, Worker deployment, traffic mutation, or secret output.

After the broker read path is proven, Phase 1 is restored to the full `predeploy-control-plane` acceptance. V4.1 Phase 1 requires registry-defined non-legacy routes, dynamic 2–8 distinct company lanes, real version creation/deployment, candidate restoration after rollback rehearsal, `legacy_route_removed:true`, and zero production business Worker traffic mutation by the L2 driver. Route count is registry-driven, not hardcoded.

The provider pool is not OpenRouter-only. Governance may combine OpenRouter ranking candidates with approved Cloudflare native/custom-provider candidates from `EXPERT_PROVIDER_CANDIDATES_JSON`. Non-regulated balanced routes may use bounded same-company challenger percentage traffic; `regulated` exploration is always zero.

Production Expert main is intentionally retired/fail-closed until clean Expert V4.1 PR #43 passes its fresh exact-head build and Phase 1 clears. Expert #43 exact head `072c95de9caec0227d7388e3237bfe8146634f19` already has candidate Build `8084070e-1935-4dc2-86ea-37a4229e7514` = PASS; that is candidate proof, not production deployment proof.

This commit changes audit text only and exists after PR #115 was created so Cloudflare Workers Builds has an observable PR-bound maintenance trigger.
