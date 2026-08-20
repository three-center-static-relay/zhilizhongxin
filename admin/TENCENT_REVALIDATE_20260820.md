# Tencent runtime revalidation trigger — 2026-08-20

Documentation-only trigger for the existing admin production gate after the previous leaked Sandbox lifetime window elapsed.

No runtime code, routing, credentials, billing policy, retry policy, or provider capability is changed by this file.

The existing gate remains authoritative:
- executor selftest v5;
- one deterministic conversation id per deployment;
- at most three bounded attempts;
- selftest cleanup calls `sandbox.kill()`;
- production remains fail-closed unless all required checks pass;
- no automatic paid fallback.
