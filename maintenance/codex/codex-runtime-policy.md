# Codex SDK Self-Maintenance Runtime Policy

## Role
Codex SDK is the engineering execution infrastructure of the Maintenance Center.

## Responsibilities
- Diagnose code and configuration faults.
- Generate repair candidates.
- Run validation workflows.
- Produce audit receipts.

## Model priority
1. Cloudflare Workers AI available free-tier strongest suitable model.
2. Open model marketplace reasoning leaderboard models ranked by cost/performance.
3. Lower ranked fallback models.

## Safety
- Constitution gate required before production changes.
- No self-approval of upgrades.
- All changes require receipt and rollback path.
