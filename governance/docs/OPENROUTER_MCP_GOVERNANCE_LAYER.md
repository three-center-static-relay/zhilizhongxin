# OpenRouter MCP Governance Layer

## Decision

OpenRouter MCP is an auxiliary governance and maintenance interface. It is not a production inference transport for the expert center.

Production expert execution remains:

`governance -> expert-worker -> OpenRouter REST API -> selected models`

The MCP path is intentionally separate:

`maintenance/development agent -> OpenRouter MCP -> live model metadata / benchmarks / pricing / docs / bounded test inference`

## Why

OpenRouter's official MCP server is designed as a development assistant for coding agents. It exposes live model catalog data, benchmarks, endpoint/provider metadata, rankings, documentation search, account credit lookup and bounded test inference. OpenRouter also states that applications should continue to call the OpenRouter API directly for production inference.

MCP is stateful and requires session/authentication management. The current OpenRouter MCP authentication flow uses a dedicated short-lived capped credential. Making that credential a hard dependency of the expert runtime would add avoidable expiry and session failure modes.

## Allowed uses

The governance/maintenance layer may use MCP to:

- inspect the live model catalog;
- compare capabilities, pricing, context limits and supported parameters;
- inspect per-provider latency/throughput/data-policy metadata;
- inspect benchmark and popularity/ranking signals;
- search OpenRouter documentation;
- inspect credits and generation metadata;
- run an explicitly requested, bounded maintenance canary through `send-message`.

## Hard prohibitions

MCP must not:

- replace the expert center's REST execution path;
- become a required dependency for normal expert tasks;
- bypass the governance center;
- enable tools or web access inside expert models;
- silently run paid inference through `send-message`;
- change expert runtime model policy without a governed code/config change;
- hold or renew long-lived production credentials.

If MCP authentication, OAuth, session setup or the MCP service fails, production expert execution continues through the existing OpenRouter REST path. No automatic failover from REST to MCP is permitted.

## Production contract

The expert runtime is required to keep these endpoints:

- catalog: `https://openrouter.ai/api/v1/models`
- inference: `https://openrouter.ai/api/v1/chat/completions`

The expert runtime must not contain `https://mcp.openrouter.ai/mcp` as an execution endpoint.

## Source check

Policy reviewed against OpenRouter's official MCP announcement and API quickstart on 2026-08-17.
