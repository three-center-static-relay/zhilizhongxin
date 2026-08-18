# Cloudflare Free-Capability Rollout Plan (2026-08-18)

Status: **APPROVED FOR STAGED ENABLEMENT; NOT YET ACTIVE IN PRODUCTION**

This document adds the useful Cloudflare free-tier capabilities to the four-center optimization plan without changing the current production bindings. Resource creation, code binding, preview acceptance, and production promotion remain separate, auditable stages.

## 1. Decision

Adopt the following capabilities in priority order:

1. **Cloudflare Access** for human-facing `admin-worker` and `governance-worker`.
2. **AI Gateway** for Workers AI and approved third-party model traffic.
3. **R2 Standard** for bounded audit receipts and build/evidence artifacts.
4. **Workers Analytics Engine** for low-cardinality operational metrics.
5. **Cloudflare Queues** for bounded asynchronous maintenance work.

Do not add D1, KV, Vectorize, Containers, AI Gateway Unified Billing, paid AI models, or R2 Infrequent Access in this stage.

## 2. Non-negotiable boundaries

- GitHub remains storage and review only. GitHub Actions and Dependabot execution remain disabled.
- Cloudflare Workers Builds remains the repository-triggered execution surface.
- No automatic production promotion. `AUTO_PROMOTE=false` remains authoritative.
- Creation of a Cloudflare resource does not authorize a production binding.
- No secret values, prompt bodies, raw personal data, credentials, copyrighted source bodies, or device-level trajectories may be written to Analytics Engine or R2.
- All background processing is serial and bounded: queue consumer concurrency `1`, batch size `1`, maximum retries `3`, then dead-letter.
- All additions must pass preview build, binding validation, a zero/near-zero-cost canary, redaction checks, and a signed receipt before production promotion.
- AI Gateway uses **Standard billing**, never prepaid Unified Billing.
- R2 uses **Standard storage**, remains private, and receives lifecycle deletion rules.
- Free-tier exhaustion must fail closed or degrade to a non-paid fallback; it must not silently purchase capacity.

## 3. Target topology

| Capability | Primary owner | Initial consumers | Purpose |
| --- | --- | --- | --- |
| Access | admin/security plane | admin-worker, governance-worker | Identity-aware protection for public control endpoints |
| AI Gateway | governance | governance-worker, expert-worker | AI analytics, caching, rate limiting, provider routing, DLP |
| R2 | governance evidence plane | admin-worker, governance-worker, maintenance-worker | Receipts, hashes, bounded artifacts |
| Analytics Engine | governance observability | all six Workers, added in stages | Success, latency, retry, rejection and estimated-cost metrics |
| Queues | maintenance plane | governance/admin producers; maintenance consumer | Backpressure and retry isolation for maintenance jobs |

The existing service bindings remain the only supported Worker-to-Worker path.

## 4. Canonical resource names

Use these exact names to prevent configuration drift:

- Access applications:
  - `four-center-admin-access`
  - `four-center-governance-access`
- AI Gateway: `four-center-ai-gateway`
- R2 bucket: `four-center-audit-evidence`
- Analytics Engine dataset: `four_center_ops_v1`
- Primary queue: `four-center-maintenance-v1`
- Dead-letter queue: `four-center-maintenance-dlq-v1`

Bindings to add only after the resources or policies exist:

- `AUDIT_EVIDENCE` -> R2 `four-center-audit-evidence`
- `OPS_ANALYTICS` -> Analytics Engine `four_center_ops_v1`
- `MAINTENANCE_QUEUE` -> Queue `four-center-maintenance-v1`

## 5. Cloudflare dashboard enablement

### 5.1 Access — enable first

For each of `admin-worker` and `governance-worker`:

1. Open Cloudflare Dashboard.
2. Go to **Workers & Pages** and select the Worker.
3. Go to **Settings > Domains & Routes**.
4. On the `workers.dev` route, select **Enable Cloudflare Access**.
5. Select **Manage Cloudflare Access**.
6. Create an Allow policy for the owner's verified email only.
7. Do not add a Bypass rule.
8. Validate both an allowed login and a denied unauthenticated request.
9. Validate the Access JWT in the Worker before relying on Access as the sole application-level check.

Keep `maintenance-worker` private with `workers_dev=false`.

Official reference: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/

### 5.2 AI Gateway

1. Go to **AI > AI Gateway**.
2. Select **Create Gateway**.
3. Name it `four-center-ai-gateway`.
4. Select **Standard billing**.
5. Do not purchase or enable Unified Billing credits.
6. Disable prompt/response body persistence unless a later privacy review explicitly approves it.
7. Enable dashboard analytics, rate limiting and caching only for deterministic/non-sensitive requests.
8. Apply free DLP profiles where applicable.
9. Route a single canary request and record provider, model, latency, cached/not-cached, and redacted request digest.

Official reference: https://developers.cloudflare.com/ai-gateway/get-started/

### 5.3 R2 Standard

1. Go to **Storage & databases > R2 > Overview**.
2. Complete the R2 subscription checkout. This activates usage-based R2; included monthly usage remains free.
3. Create the private bucket `four-center-audit-evidence`.
4. Select **Standard** storage only.
5. Do not expose `r2.dev` and do not make the bucket public.
6. Add lifecycle deletion:
   - temporary build/test artifacts: 30 days;
   - accepted audit receipts: 90 days unless a documented retention requirement overrides it.
7. Keep storage below an internal soft target of 5 GB.
8. Permit only structured receipts, hashes, source URLs, timestamps, policy versions, and bounded derived artifacts.

Official references:
- https://developers.cloudflare.com/r2/get-started/
- https://developers.cloudflare.com/r2/buckets/object-lifecycles/

Planned Wrangler binding:

```jsonc
{
  "r2_buckets": [
    {
      "binding": "AUDIT_EVIDENCE",
      "bucket_name": "four-center-audit-evidence"
    }
  ]
}
```

### 5.4 Workers Analytics Engine

No dataset must be created manually. The dataset is created on the first write after a binding is deployed.

Planned binding:

```jsonc
{
  "analytics_engine_datasets": [
    {
      "binding": "OPS_ANALYTICS",
      "dataset": "four_center_ops_v1"
    }
  ]
}
```

Canonical event schema:

- blobs: center, operation, outcome, provider;
- doubles: latency_ms, cpu_ms, retry_count, estimated_cost_microusd;
- index: a non-reversible request/receipt digest;
- prohibited: email, IP address, prompt/body text, token, credential, raw personal identifier.

Start with `admin-worker` and `governance-worker`, validate cardinality, then add intelligence, compute, expert and maintenance.

Official reference: https://developers.cloudflare.com/analytics/analytics-engine/get-started/

### 5.5 Queues

1. Go to **Workers & Pages > Queues**.
2. Create `four-center-maintenance-v1`.
3. Create `four-center-maintenance-dlq-v1`.
4. Bind the primary queue as a producer to governance/admin only after producer code is contract-tested.
5. Bind the primary queue as a consumer to `maintenance-worker`.
6. Set:
   - `max_batch_size=1`;
   - `max_batch_timeout=5`;
   - `max_retries=3`;
   - `max_concurrency=1`;
   - `dead_letter_queue=four-center-maintenance-dlq-v1`.
7. Messages contain only an operation ID, receipt digest, capability tag, deadline, attempt number, and bounded parameters.
8. Every consumer operation must be idempotent. A message is acknowledged only after its receipt is durably written.

Planned configuration:

```jsonc
{
  "queues": {
    "producers": [
      {
        "binding": "MAINTENANCE_QUEUE",
        "queue": "four-center-maintenance-v1"
      }
    ],
    "consumers": [
      {
        "queue": "four-center-maintenance-v1",
        "max_batch_size": 1,
        "max_batch_timeout": 5,
        "max_retries": 3,
        "max_concurrency": 1,
        "dead_letter_queue": "four-center-maintenance-dlq-v1"
      }
    ]
  }
}
```

Producer and consumer entries belong in their respective Worker configurations; do not copy both blocks into every Worker.

Official references:
- https://developers.cloudflare.com/queues/get-started/
- https://developers.cloudflare.com/queues/configuration/configure-queues/

## 6. Cost and abuse controls required before production binding

- Add explicit `limits.cpu_ms` appropriate to each Worker after measuring preview usage.
- Keep Browser Run concurrency at `1`; always close sessions in `finally`.
- Set a governance soft stop below the Workers AI free ceiling, initially 8,000 neurons/day.
- Reduce broad production log sampling after a short baseline period; preserve security/error events through structured logging.
- R2: private, Standard only, lifecycle enabled, internal 5 GB soft target.
- Queues: serial consumer, at most three retries, DLQ, idempotency key and deadline required.
- AI Gateway: Standard billing, no prepaid credits, no raw body persistence, bounded rate limits.
- Analytics: low cardinality only; one index; no personal or secret data.
- Review Cloudflare usage dashboards weekly during the first month.

Cloudflare product quotas are not a universal hard account spending cap. Application-level limits remain mandatory.

## 7. Acceptance gates

Each capability receives a separate preview-only canary.

### Access
- unauthenticated request denied;
- approved identity allowed;
- service-binding traffic unaffected;
- Access JWT validated.

### AI Gateway
- one real provider call;
- gateway analytics visible;
- rate limit tested without repeated billable calls;
- no prompt/response body retained;
- Standard billing confirmed.

### R2
- write, head/get, digest comparison and delete succeed;
- bucket remains private;
- lifecycle rule visible;
- no secret or raw personal data present.

### Analytics Engine
- one redacted data point written;
- SQL query returns the expected schema;
- no prohibited dimensions;
- cardinality bound recorded.

### Queues
- one message produced and consumed;
- concurrency observed as one;
- one controlled retry;
- one DLQ canary;
- idempotent duplicate does not repeat side effects.

A capability remains `PLANNED` or `PREVIEW_ACCEPTED` until a receipt contains resource name, Worker version, commit SHA, configuration digest, timestamps and observed response fields. No dashboard screenshot alone is sufficient for production PASS.

## 8. Rollout order

1. Access for admin and governance.
2. AI Gateway with one redacted canary.
3. R2 private bucket and lifecycle.
4. Analytics Engine on admin/governance only.
5. Queue and DLQ with maintenance consumer.
6. Extend Analytics Engine to remaining centers.
7. Reassess Workers Paid only when Browser Run, CPU or Workflow limits prove that Free is insufficient.

## 9. Rollback

- Access: retain policy and disable only after restoring equivalent authentication.
- AI Gateway: route calls back to the direct provider endpoint; retain redacted metrics.
- R2/Analytics bindings: stop writes first, deploy the binding removal in preview, then production.
- Queue: stop producers, drain or move remaining messages to DLQ, remove consumer binding, then remove producer binding.
- Resource deletion is a separate destructive action and always requires explicit human authorization.

## 10. Current implementation state

This document changes governance policy only. It does **not**:

- create Cloudflare resources;
- add live Wrangler bindings;
- change production traffic;
- enable a paid product;
- purchase credits;
- merge this Draft PR;
- claim runtime PASS.
