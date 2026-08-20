# Tencent TokenHub provider candidate

Status: candidate only; fail-closed; not production-enabled until the provider key is stored and a fresh `/v1/models` plus chat-completions acceptance passes.

## Fixed integration contract

- Provider: Tencent Cloud TokenHub
- Region/site: Guangzhou / China mainland
- Cloudflare Custom Provider slug: `tencent-tokenhub`
- Cloudflare model provider reference prefix: `custom-tencent-tokenhub/`
- Custom Provider `base_url`: `https://tokenhub.tencentmaas.com`
- TokenHub OpenAI-compatible API root: `https://tokenhub.tencentmaas.com/v1`
- Authentication upstream: `Authorization: Bearer <API KEY>`
- Logical application secret name: `TENCENT_TOKENHUB_API_KEY`
- Cloudflare AI Gateway: `test`
- BYOK alias: `default`

For API-managed Cloudflare Secrets Store/BYOK, Cloudflare requires the secret naming convention `{gateway_id}_{provider_slug}_{alias}`. With the current gateway/slug/alias this resolves to:

`test_tencent-tokenhub_default`

Do not reuse or overwrite the existing Tencent executor secrets (`TENCENT_MAKERS_API_TOKEN`, `TENCENT_EXECUTOR_SHARED_TOKEN`). TokenHub is a separate model-provider credential and has no Tencent Makers/EdgeOne execution authority.

## Admission sequence

1. Create TokenHub API Key in Tencent Cloud.
2. Store it in Cloudflare AI Gateway BYOK for provider `tencent-tokenhub`, alias `default`; do not commit the value to GitHub.
3. Create the Cloudflare Custom Provider in disabled state.
4. Run authenticated `GET /v1/models` through the provider path and verify the expected site/key pairing.
5. Run one bounded chat-completions canary.
6. Only after both checks pass, enable the provider and admit explicit model IDs into the expert provider candidate registry.
7. On 401/402/429 or schema drift, leave disabled/fail-closed; no automatic paid fallback.
