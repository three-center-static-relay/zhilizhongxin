# Security policy

## Supported branch

Security fixes target the default branch and must pass the repository build gate before deployment. Draft pull requests and dry runs are not production approval.

## Report a vulnerability

Use this repository's **Security > Report a vulnerability** private advisory flow. Do not open a public issue for suspected vulnerabilities and do not include credentials, tokens, production payloads, customer data, or exploit material in commits, pull-request comments, build logs, or screenshots.

Include the affected Worker and route, impact, minimal reproduction, relevant version or commit, and any safe mitigation. Maintainers should acknowledge, triage, remediate, validate, and disclose through the private advisory workflow.

## Deployment and secret controls

- Store runtime credentials only as Cloudflare secrets; never in GitHub source, Wrangler vars, fixtures, or logs.
- Non-production GitHub branches run `wrangler deploy --dry-run` only. Production mutation requires the protected `main` path and explicit `cf:deploy`.
- Internal center Workers have `workers_dev: false` and are reached through Cloudflare service bindings. Public ingress belongs only at the governed gateway.
- Durable Object lifecycle changes require an audited migration plan and rollback boundary review; do not replace `exports` with `migrations` without deployment-history evidence.
- Rotate a credential immediately if exposure is suspected, then invalidate affected sessions and review Cloudflare/GitHub audit events.

## Verification standard

A configured provider is not a verified provider. Capability, reliability, accuracy, fitness, freshness, or trust claims require a bound runtime receipt with timestamp, sample size, acceptance criteria, and digest; absent evidence is reported as unknown or unverified.

