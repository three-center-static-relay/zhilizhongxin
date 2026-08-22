# Codex SDK Runtime Integration

## Role

Codex is an engineering execution capability of Maintenance Center.

## Execution flow

1. Detect maintenance candidate
2. Constitution gate validation
3. Select model source
4. Execute Codex task
5. Produce receipt
6. Run validation before promotion

## Model priority

1. Cloudflare Workers AI free strongest available model
2. Open model market reasoning leaderboard with value ranking
3. Fallback candidates

## Safety boundaries

- No bypass of constitution gate
- No self approval of upgrades
- All executions require receipts
- Production promotion remains separately validated
