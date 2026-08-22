# Policy Engine

## Purpose

Governance enforcement layer for the evolution system.

## Allowed model sources

- cloudflare_workers_ai
- openrouter
- huggingface

All model routing must pass this policy layer.

## Blocked direct providers

Direct model providers outside the approved pool are rejected unless explicitly approved by governance.
