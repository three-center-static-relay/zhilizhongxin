# Neon shared memory

## Role

Neon PostgreSQL is the long-term institutional memory for the LA/governance control plane. Intelligence, compute and expert centers do not receive the database credential directly. LA/governance persists redacted task plans, supervisor state and later center receipts through the governed shared-memory adapter.

## Secret boundary

Only `governance-worker` receives this Cloudflare Secret:

`NEON_DATABASE_URL`

The value is the Neon PostgreSQL connection string. Never commit it to GitHub, Wrangler config, logs, receipts, issue comments or task payloads. `NEON_API_KEY` is deliberately not required and must not be added to production merely for database access.

## Runtime behavior

- If `NEON_DATABASE_URL` is absent, core LA planning remains available and memory persistence reports `NEON_DATABASE_URL_NOT_CONFIGURED` without exposing credentials.
- On the first successful memory write, the adapter creates the fixed `think_tank_memory` table and indexes if absent.
- Stored payloads are bounded and recursively redact token/secret/password/API-key/credential/database-URL-like fields.
- Memory failure is fail-soft for orchestration: it cannot silently turn a valid LA plan into a production side effect or expose a Secret.
- The current schema is `think-tank-memory-v1`.

## Ownership

`governance-worker` / LA is the single credential owner. Intelligence, compute and expert centers remain credential-isolated and use the shared memory through LA-controlled flows rather than direct Neon credentials.
