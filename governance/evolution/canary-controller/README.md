# Canary Controller

Purpose: validate model and governance changes before production promotion.

Flow:

1. Candidate discovered from approved sources only:
   - Cloudflare Workers AI
   - OpenRouter
   - Hugging Face
2. Run evaluation suite.
3. Compare against current production baseline.
4. Promote or reject.

This module is controlled by Governance Policy Engine.
