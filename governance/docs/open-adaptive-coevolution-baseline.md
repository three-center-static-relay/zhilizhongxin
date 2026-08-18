# Open Adaptive Co-Evolutionary Intelligence System

This repository is the canonical control-plane implementation of the four-center adaptive architecture.

## Implemented foundation

- L0 constitution and fail-closed production invariants.
- Capability ABI v1 and a four-center Capability Genome contract.
- Task, Evidence, Receipt, and Evolution contract schemas.
- Live Self Model compilation through Cloudflare service bindings.
- Gap Model, deterministic Fast/Deep task planning, fallback candidates, and graph receipts.
- Observe-only Entropy Governor for redundancy, staleness, fragility, and deprecation signals.
- Evolution Contract validation before a candidate may enter quarantine.
- Evidence-bound capability admission: configuration alone is `T0 / configured-unverified`; routing requires `verification.status=verified`, a verification timestamp, and a runtime receipt.
- Global coordination locks with task-ID Durable Object shards, so mutual exclusion is preserved without concentrating all task history in one object.
- Internal center isolation through service bindings; intelligence, compute, expert, and maintenance Workers do not expose `workers.dev` endpoints.
- Build-only pull-request validation with `wrangler deploy --dry-run`; production mutation remains an explicit protected action.

## Evidence semantics

`generated_at` and `health.checked_at` describe when a manifest was assembled or configuration was inspected. They do not prove runtime correctness and must never populate `last_verified`. Reliability, accuracy, cost, fitness, freshness, and trust stay unknown or zero until a bound acceptance run records scope, sample size, timestamp, and receipt digest. A provider secret being present is configuration evidence only.

Large model answers are response data, not Durable Object coordination state. The expert center persists operational metadata and a content digest; durable content retention requires a separately governed R2 binding, retention policy, encryption/access review, and deletion workflow.

## Account-level controls still required

Repository source cannot prove or change Cloudflare account history, GitHub Rulesets, or secret inventory. Before production promotion, operators must verify:

1. GitHub Rulesets require the Cloudflare build check, code-owner review, signed or verified commits where policy requires it, conversation resolution, and no force-push/deletion on `main`.
2. Cloudflare non-production commands match `CLOUDFLARE_BUILDS.md`; top-level Durable Object `exports` are preserved unless deployment history proves a reviewed migration is safe.
3. Staging uses separate Worker names, Durable Object namespaces, service bindings, secrets, and routes. A dry run is not runtime staging.
4. Public gateways use Access/WAF/rate-limit controls as appropriate; internal centers remain service-binding only.
5. Secret Store/Worker secrets, token scope, rotation, Logpush/observability retention, alerting, and audit-log export are reviewed against the organization threat model.

## Intentionally disabled

Automatic installation, production promotion, deletion, self-modification, and meta-evolution remain disabled. LangGraph is treated as the future dynamic neural-system adapter, but it stays quarantined until the deterministic Phase 0–2 contracts have passed shadow and canary validation. This preserves the required sequence: contract → simulation → shadow → canary → promote → rollback.

## Stable boundary

The permanent organs remain governance, intelligence, compute, and expert. New models, APIs, MCP servers, datasets, algorithms, and providers must enter as capabilities; they must not create new centers.
