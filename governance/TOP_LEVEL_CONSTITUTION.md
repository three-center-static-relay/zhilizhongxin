# Top-Level Constitution

This file records system-wide constitutional rules that apply across governance, intelligence, compute, expert, maintenance, and future domain branches. A lower-level policy may be stricter but may not weaken these rules.

## G17 — Government public data: privacy-first public acquisition

For government and other public-sector data, prefer **lawfully public, unauthenticated acquisition** of official public webpages, downloadable files, public feeds, and other openly available publications over account-bound API or MCP access when the same evidence can be obtained with adequate quality and freshness.

### Mainland China default rule

For **government information and public-sector data originating from Mainland China**, public collection is the default acquisition path across the whole system. Prefer fixed-source collection of the authoritative public publication over government API, MCP, account-bound portal access, phone-number registration, real-name verification, or other identity-linked access.

This default applies to central, provincial, municipal, county/district, township/subdistrict and other Mainland China public bodies, including government departments, public institutions and official public-data portals, when the required evidence is already lawfully exposed to ordinary public browsing or download.

Authenticated API/MCP access to Mainland China government sources is an exception, not a convenience default. It may be considered only when a materially important capability cannot be obtained from lawful public publication with adequate quality/freshness, the access terms permit the intended use, and the identity/privacy tradeoff has been explicitly approved.

The objective is **data minimization and identity-disclosure minimization**, not anti-detection or guaranteed anonymity. Network requests may still be logged by the source server (for example IP address, user agent, request time, requested path, and other ordinary server metadata), so the system must never claim that web collection is anonymous, untraceable, or invisible to the source.

Mandatory rules:

1. Do not create or use a government account, API credential, MCP identity, phone number, real-name verification, or other identity-linked credential merely for convenience when an equivalent lawfully public source is sufficient.
2. For Mainland China government/public-sector sources, choose fixed official-source collection first for public HTML, PDF, XLS/XLSX, CSV, JSON exposed to ordinary public browsing/download, RSS/Atom, public map layers, official notices, statistical bulletins, project approvals, planning disclosures, land transactions and other openly published material.
3. Use bounded, low-frequency, cache-first and incremental collection. Preserve `source_url`, `publisher`, `published_at` when available, `fetched_at`, `content_hash`, parser/version metadata, and evidence classification.
4. Respect applicable access controls, terms, robots directives where applicable, rate limits, copyright/database rights, privacy rules, and source-specific reuse restrictions.
5. Never bypass login, CAPTCHA, paywalls, access controls, rate limits, or technical restrictions. Never use fingerprint spoofing, proxy rotation, credential cycling, anti-bot evasion, stealth/anti-detection mechanisms, or other techniques whose purpose is to conceal automated collection from the source.
6. Do not collect or persist personal identifiers, device identifiers, raw individual trajectories, or other personal data merely because a public page exposes them. Prefer aggregate/statistical evidence.
7. If a required government dataset is available only through authenticated API/MCP/account access, classify it as `identity-linked-access-required`; do not activate it automatically. Require explicit approval and the minimum necessary credential scope, or fail closed and use an alternative public source/proxy.
8. Search/discovery tools may locate candidate government sources, but production evidence must come from the validated official source itself and retain provenance.
9. Collection parsers must fail closed when the source layout, publication semantics or structured fields materially change. Do not silently continue extracting uncertain values after a source-format drift.

### Decision rule

For Mainland China government information, choose **public collection first** whenever the authoritative publication is lawfully available without identity-linked access. When public collection and authenticated API/MCP provide materially equivalent evidence, choose **public collection**. Choose authenticated API/MCP only when it provides a material quality/freshness capability that cannot be obtained lawfully from public publication and the identity/privacy tradeoff has been explicitly accepted.
