# Top-Level Constitution

This file records system-wide constitutional rules that apply across governance, intelligence, compute, expert, maintenance, and future domain branches. A lower-level policy may be stricter but may not weaken these rules.

## G17 — Government public data: privacy-first public acquisition

For government and other public-sector data, prefer **lawfully public, unauthenticated acquisition** of official public webpages, downloadable files, public feeds, and other openly available publications over account-bound API or MCP access when the same evidence can be obtained with adequate quality and freshness.

The objective is **data minimization and identity-disclosure minimization**, not anti-detection or guaranteed anonymity. Network requests may still be logged by the source server (for example IP address, user agent, request time, requested path, and other ordinary server metadata), so the system must never claim that web collection is anonymous, untraceable, or invisible to the source.

Mandatory rules:

1. Do not create or use a government account, API credential, MCP identity, phone number, real-name verification, or other identity-linked credential merely for convenience when an equivalent lawfully public source is sufficient.
2. Prefer fixed official-source collectors for public HTML, PDF, XLS/XLSX, CSV, JSON exposed to ordinary public browsing/download, RSS/Atom, public map layers, and other openly published material.
3. Use bounded, low-frequency, cache-first and incremental collection. Preserve `source_url`, `publisher`, `published_at` when available, `fetched_at`, `content_hash`, parser/version metadata, and evidence classification.
4. Respect applicable access controls, terms, robots directives where applicable, rate limits, copyright/database rights, privacy rules, and source-specific reuse restrictions.
5. Never bypass login, CAPTCHA, paywalls, access controls, rate limits, or technical restrictions. Never use fingerprint spoofing, proxy rotation, credential cycling, anti-bot evasion, stealth/anti-detection mechanisms, or other techniques whose purpose is to conceal automated collection from the source.
6. Do not collect or persist personal identifiers, device identifiers, raw individual trajectories, or other personal data merely because a public page exposes them. Prefer aggregate/statistical evidence.
7. If a required government dataset is available only through authenticated API/MCP/account access, classify it as `identity-linked-access-required`; do not activate it automatically. Require explicit approval and the minimum necessary credential scope, or fail closed and use an alternative public source/proxy.
8. Search/discovery tools may locate candidate government sources, but production evidence must come from the validated official source itself and retain provenance.

### Decision rule

When public collection and authenticated API/MCP provide materially equivalent evidence, choose **public collection**. Choose authenticated API/MCP only when it provides a material quality/freshness capability that cannot be obtained lawfully from public publication and the identity/privacy tradeoff has been explicitly accepted.
