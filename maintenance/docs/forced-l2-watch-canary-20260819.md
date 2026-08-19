# Forced maintenance L2 watch canary — 2026-08-19

Purpose: force a maintenance-scope Cloudflare Workers Build using a path class that has previously produced a successful maintenance-only canary, while the same commit also changes `maintenance/l2-acceptance-request.json` so the repository gate executes the explicit fail-closed L2 acceptance.

Expected behavior:
- maintenance-worker: Cloudflare Build triggered; repository gate ALLOW; L2 requested=true; candidate upload + bounded L2 acceptance runs.
- admin-worker and governance-worker: may receive Git integration events but repository gate must SKIP because this commit changes only `maintenance/` paths.
- no merge; no production traffic to candidate versions; Dynamic Routes and Worker deployments restored to their pre-test snapshots after the rehearsal.

This file is an audit marker only and contains no credentials.
