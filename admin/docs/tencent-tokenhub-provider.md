# Tencent TokenHub provider candidate

Status: candidate only; fail-closed; not production-enabled until credential binding plus a fresh `/v1/models` and chat-completions acceptance pass.

## Fixed integration contract

- Provider: Tencent Cloud TokenHub
- Region/site: Guangzhou / China mainland
- Account custom-provider slug: `tencent-tokenhub`
- Runtime AI Gateway provider reference: `custom-tencent-tokenhub`
- Custom Provider `base_url`: `https://tokenhub.tencentmaas.com`
- TokenHub OpenAI-compatible API path prefix: `/v1`
- Upstream authentication: `Authorization: Bearer <API KEY>`
- Logical application secret name: `TENCENT_TOKENHUB_API_KEY`
- Cloudflare AI Gateway: `test`
- Preferred BYOK alias: `default`

Do not reuse or overwrite the existing Tencent executor secrets (`TENCENT_MAKERS_API_TOKEN`, `TENCENT_EXECUTOR_SHARED_TOKEN`). TokenHub is a separate model-provider credential and has no Tencent Makers/EdgeOne execution authority.

## Current Cloudflare dashboard boundary — 2026-08-20

The gateway **Provider Keys** selector currently exposes Cloudflare native providers and does not surface this account custom provider in the dashboard list. Do not keep searching for Tencent TokenHub in that selector.

Cloudflare's current Custom Provider documentation still recommends BYOK, and the AI Gateway Provider Config API supports creating a gateway provider configuration with `provider_slug`, `alias`, and either `secret` or `secret_id`. Therefore the intended low-touch path is API-managed provider configuration rather than forcing a dashboard-native-provider entry.

Cloudflare's current public Dynamic Routing documentation documents native-provider model nodes and an upstream-key/BYOK prerequisite, but does not document Custom Provider model nodes as production-supported. Until a real Tencent custom-provider Dynamic Route canary passes, TokenHub must remain outside production Dynamic Routes and must not be claimed as a dynamic-route lane.

## Admission sequence

1. Keep the Tencent TokenHub key out of GitHub and plaintext configuration.
2. Stage it only as Cloudflare Secret `TENCENT_TOKENHUB_API_KEY` under the credential-custodian Worker when bootstrap is required.
3. Create/verify the `test` gateway provider configuration through Cloudflare's Provider Config API using runtime provider slug `custom-tencent-tokenhub` and alias `default`; redact all secret values from receipts.
4. Run authenticated `GET /v1/models` through `custom-tencent-tokenhub` and verify the expected site/key pairing.
5. Run one bounded chat-completions canary.
6. Admit TokenHub to normal provider selection only after those checks pass.
7. Do not admit TokenHub to Dynamic Routes until a real Custom Provider Dynamic Route canary passes on the current Cloudflare platform.
8. On 401/402/429, provider-config failure, or schema/path drift, remain disabled/fail-closed; no automatic paid fallback.
