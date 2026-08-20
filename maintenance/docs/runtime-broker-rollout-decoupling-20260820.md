# Maintenance runtime-broker rollout decoupling — 2026-08-20

Maintenance is a read-only observability Worker. Its deployment uses the existing shared Cloudflare gate and is not rolled back merely because the Expert AI Gateway broker is unhealthy. Broker health is recorded as degraded/persistent failure; Expert route promotion remains separately fail-closed.

This marker exists after PR #119 creation to request an observable maintenance preview. It changes no runtime behavior.
