# Expert model candidate pool governance

## Purpose

The expert panel uses Cloudflare AI Gateway Dynamic Routing at runtime, but model discovery remains ranking-driven. OpenRouter is the external marketplace used to discover high-quality reasoning candidates; the Expert Worker does not query OpenRouter during a live task.

## Canonical discovery source

Use the OpenRouter Models API ordered by intelligence:

```text
GET https://openrouter.ai/api/v1/models?supported_parameters=reasoning&output_modalities=text&sort=intelligence-high-to-low
```

The returned order is treated as the primary reasoning-quality ordering for candidate discovery.

## Hard filters

Before a model can enter the candidate pool it must:

- support reasoning
- support text output
- be paid
- not contain `:free`
- not contain `flash`
- not belong to OpenAI
- not belong to Anthropic / Claude
- not be expired or deprecated

## Company deduplication

Walk the filtered ranking from top to bottom. The first eligible company becomes `expert-1`; the next previously unused company becomes `expert-2`; the next becomes `expert-3`; the fourth becomes `judge`.

For each selected company, retain up to three ranked models from that same company:

- first = primary
- remaining = same-company fallback candidates

This preserves both ranking priority and exact cross-company panel diversity.

## Runtime boundary

The ranking is **not** a floating runtime router.

```text
OpenRouter ranking
  -> governance candidate filtering
  -> company deduplication
  -> proposed Cloudflare route version
  -> preview validation
  -> deploy route version
  -> Expert Worker runtime verification
```

The active Cloudflare route stays pinned until a replacement version has passed preview validation. Ranking movement alone must never mutate the production route in place.

## Task-adaptive selection

The Expert Worker supplies these allow-listed metadata fields to Cloudflare:

- `expert_slot`
- `task_domain`
- `task_type`
- `complexity`
- `reasoning_depth`
- `context_size`
- `latency_priority`
- `cost_priority`

Cloudflare may choose different concrete models within the already-approved company lane according to those fields. Fallback must stay inside the same company.

## Secondary signals

The OpenRouter intelligence ordering is primary. Before promoting a route version, governance may use these secondary signals as tie-breakers or health checks:

- weekly popularity
- recent latency
- recent throughput
- provider availability
- expert-center execution receipts
- observed task-specific quality regressions

Secondary signals must not override hard exclusions.

## Promotion rule

A newly discovered model remains a candidate until preview tests confirm:

1. the exact model is callable through the configured AI Gateway/provider path;
2. `cf-aig-model` and `cf-aig-provider` identify the expected result;
3. expert panel company diversity still holds;
4. no forbidden model/company is selected;
5. same-company failure behavior is fail-closed;
6. representative deep, standard, long-context, coding, quantitative, legal, finance, and general tasks complete within configured timeouts.

Production promotion is a separate explicit route-version action.
