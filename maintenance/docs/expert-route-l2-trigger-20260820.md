# Expert V4.1 control-plane acceptance — 2026-08-20

This maintenance scope belongs only to the clean Expert V4.1 Cloudflare control plane. It must not restore stale Expert or China-compute history.

Current observable preflight request: `expert-v4.1-post-admin-refresh-remote-broker-read-20260820-1128`.

The preview runs static V4.1 contracts and a read-only broker canary with the driver itself executed in Cloudflare remote development:
`wrangler dev --remote -> AI_GATEWAY_CONTROL -> admin-worker:AIGatewayControl -> routes.list`.

This retrigger follows the dedicated admin runtime refresh PR #116, merged to governance main as `5193ca8edaf703c30333395c522aa831766af9c5`. The PR exact-head admin preview `fc04a8a1c655eea6153c7f193b1a24e6e7b00468` passed Cloudflare Build `e98b3d65-1717-44cf-a9d9-fa8eced91d18`; the broker read remains the authoritative runtime proof that the live admin version actually exposes the named entrypoint and can read AI Gateway routes.

Read preflight safety: no route/version creation, Dynamic Route deployment, rollback, Expert call, production Worker deployment, production traffic mutation, or secret output.

After the broker read path is proven, Phase 1 is restored to full `predeploy-control-plane` acceptance. V4.1 Phase 1 requires registry-defined non-legacy routes, dynamic 2–8 distinct company lanes, real version creation/deployment, candidate restoration after rollback rehearsal, `legacy_route_removed:true`, and zero production business Worker traffic mutation by the L2 driver. Route count is registry-driven, not hardcoded.

The provider pool is not OpenRouter-only. Governance may combine OpenRouter ranking candidates with approved Cloudflare native/custom-provider candidates from `EXPERT_PROVIDER_CANDIDATES_JSON`. Non-regulated balanced routes may use bounded same-company challenger percentage traffic; `regulated` exploration is always zero.

Production Expert main remains retired/fail-closed until clean Expert V4.1 PR #43 and Phase 1 are both proven. Expert #43 exact head `072c95de9caec0227d7388e3237bfe8146634f19` has candidate Build `8084070e-1935-4dc2-86ea-37a4229e7514` = PASS; that is candidate proof, not production deployment proof.
