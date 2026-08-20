# Governance broker production retry note

This file exists only to force a real Cloudflare governance-worker production deployment after the AI Gateway credential broker migration.

Runtime behavior is unchanged. The purpose is to distinguish deployment/runtime conditions from code-path failures.

Architecture contract:

- governance does not hold Cloudflare AI Gateway credentials.
- governance reads through the credential broker path.
- credential custody remains centralized.
