# Unified Model Source Policy V1

Effective decision date: 2026-08-20.

## System-wide allowlist

All model inference used by governance, intelligence, compute, expert, maintenance, or future domain modules must come from this shared allowlist unless a later governed change explicitly replaces it:

1. **Cloudflare Workers AI** — first-party Cloudflare-hosted models. No third-party Provider Key is required. Prefer for free/low-cost first pass, lightweight reasoning, embeddings, classification and other supported workloads.
2. **OpenRouter** — broad multi-company model supermarket. Provider credential is stored centrally in Cloudflare AI Gateway Provider Keys/BYOK, never duplicated across Workers.
3. **DeepSeek** — direct single-vendor quality/resilience path. Provider credential is stored centrally in Cloudflare AI Gateway Provider Keys/BYOK.
4. **Hugging Face** — open-model ecosystem and fallback/experimental inference path. Provider credential is stored centrally in Cloudflare AI Gateway Provider Keys/BYOK.

No other model provider is admitted by default. Alibaba, Tencent TokenHub, ByteDance, Moonshot, Mistral, Google, Groq, Cerebras and other providers remain outside the production model-source allowlist unless a later governance decision explicitly admits them.

## Routing principle

This is a source whitelist, not a requirement that every center call every source.

Default selection order is task-dependent:

- **free-first / routine:** Workers AI first; then free/low-cost models exposed through OpenRouter or Hugging Face when suitable; DeepSeek only when needed.
- **balanced:** OpenRouter dynamic multi-company selection first; Workers AI and Hugging Face as low-cost/fallback paths; DeepSeek as direct quality/resilience path.
- **quality-first / regulated:** select the strongest admissible model for the task using current quality, reliability, latency and cost evidence; direct DeepSeek may be preferred where it materially improves quality, while OpenRouter remains the broad comparison pool.

The scheduler must not infer that one source is globally best. Model choice remains capability-, evidence-, cost- and availability-aware.

## Credential boundary

- Workers AI: no third-party Provider Key; authenticate with Cloudflare account/Worker bindings as required by Cloudflare.
- OpenRouter, DeepSeek and Hugging Face: Provider Keys/BYOK in Cloudflare AI Gateway.
- Do not copy these provider keys into Expert Worker or other center-specific Worker secrets unless Cloudflare technically requires a narrowly scoped exception and governance records it.
- Secret values must never be committed to GitHub or included in receipts/logs.

## Complexity rule

Adding another provider is not an upgrade by itself. A new model source is admitted only when it provides a material capability, reliability, cost or jurisdictional advantage that cannot be obtained from the existing four-source fabric, and the expected value exceeds added operational complexity.

## Failure and fallback

- Fail closed on missing/invalid credentials, unsupported model IDs, billing/permission errors or provider schema drift.
- No automatic paid fallback beyond an explicitly governed budget mode.
- Preserve provider/model receipts for observability without exposing credentials or full sensitive prompts.
- A provider outage must not change the global allowlist; routing may temporarily fall back to another admitted source.

## Architecture intent

The intended system is a small number of stable model-source entrances with a large replaceable model pool behind them:

`Workers AI + OpenRouter + DeepSeek + Hugging Face -> Cloudflare AI Gateway / governed scheduler -> all centers`

The goal is to increase model diversity while reducing credential sprawl, routing code, maintenance burden and user cognitive load.
