# Persistent exact-SHA runtime gate receipt marker — 2026-08-20

No Worker runtime behavior changes. This marker exists only to keep an audit PR open against a fixed receipt-base branch while the exact same head commit is fast-forwarded to `main`, allowing Cloudflare Bot to retain a place to surface any subsequent production build update for that SHA.

The existing maintenance production gate remains unchanged and read-only with respect to AI Gateway routes: shared fail-closed gate, ephemeral maintenance candidate deploy, guarded named Service Binding `routes.list` runtime E2E, clean final deploy, automatic rollback on failure. No Dynamic Route mutation and no Expert call are introduced.
