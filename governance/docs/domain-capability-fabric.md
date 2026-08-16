# Domain Capability Fabric v1

## Purpose

The system keeps four stable centers: Governance, Intelligence, Compute, and Expert. Domain count may grow without creating a new top-level repository or center for every subject area.

Domains such as medicine, geospatial, commercial, finance/quant, legal/policy, macro/industry, social behavior, logistics, climate/environment, and future domains are modules inside the stable centers.

## Core rules

1. **Capabilities are domain-modular.** New subject areas are added as domain modules, manifests, recipes, schemas, tests, and governed Actions.
2. **Evidence is cross-domain when policy and licensing allow.** A WorldPop result may support commercial, medical, logistics, policy, or geospatial work without duplicating the raw source.
3. **Professional logic remains domain-specific.** Reusing evidence does not merge the medical, finance, legal, or commercial decision rules.
4. **Shared primitives are implemented once.** Statistics, optimization, causal inference, Bayesian methods, graph analysis, simulation, geospatial primitives, and provenance should be reused rather than copied into each domain.
5. **Cross-domain exchange uses contracts, not private imports.** Centers and domain modules exchange bounded evidence/model envelopes with provenance and SHA-256 digests.
6. **Unknown domains and breaking contract changes fail closed.** A new domain must declare its identifier, owner centers, capability tags, evidence contract, and tests.
7. **Proxy data must stay labeled as proxy/model/synthetic.** No domain may relabel modeled mobility, inferred demand, or other proxies as observed phone footfall, observed sales, or other ground truth.

## Repository boundaries

- `qingbaozhongxin`: provider adapters, evidence retrieval, source metadata, normalization, provenance.
- `jisuanzhongxin`: reusable mathematical primitives and bounded domain recipes.
- `zhuanjiatuan`: expert evaluation and synthesis; expert inference remains separated from data acquisition and arbitrary tools.
- `zhilizhongxin`: canonical policies, schemas, Action contracts, domain registry, release/maintenance governance.

Do not create a new top-level repository merely because a new domain is added. A new repository is justified only when the runtime/security boundary is materially different from all four existing centers.

## Recommended internal layout for gradual migration

This is a target layout, not a big-bang rewrite requirement.

```text
src/
  shared/
  providers/
  domains/
    medicine/
    geospatial/
    commercial/
    finance-quant/
    legal-policy/
    ...
```

Existing `adapters-extra*.js`, large recipe modules, and other legacy groupings should be migrated incrementally when touched. Do not rewrite stable code solely for cosmetic folder structure.

## Cross-domain evidence flow

```text
Provider / dataset / MCP / API
        -> Intelligence normalization
        -> Shared Evidence Envelope
        -> Governance policy/route check
        -> one or more domain recipes
        -> Compute / Expert as required
        -> result + provenance + digest
```

A single evidence envelope may carry multiple `domain_tags`. The consuming domain remains responsible for validating fitness-for-use.

## Extension checklist

A new domain is acceptable when all of the following exist:

- stable `domain-id` in `config/domain-registry.json`;
- clearly declared center ownership;
- capability tags and reusable primitives identified;
- evidence inputs compatible with `shared-evidence-envelope.schema.json`;
- bounded domain-specific recipe or Action schema where execution is required;
- deterministic contract tests;
- no new public Worker or repository unless a separate security/runtime boundary is required;
- no duplicated secret or provider integration if a shared provider already exists;
- migration and rollback path for contract changes.

## Maintenance model

- Keep build gates deterministic and short; run full regression separately.
- Use Cloudflare Service Bindings for center-to-center traffic.
- For monorepo Workers, isolate root directories and build watch paths per Worker.
- Keep maintenance read-only by default; code/dependency upgrades require explicit governed promotion.
- Keep GitHub as source/version storage; runtime execution remains in the runtime centers.
- Prefer additive versioned schemas and adapters over destructive rewrites.
