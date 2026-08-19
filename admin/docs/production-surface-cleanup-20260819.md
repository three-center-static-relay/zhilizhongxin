# Production surface cleanup

The temporary Cloudflare Workers Builds diagnostic endpoint introduced for one-shot troubleshooting was removed before final Tencent production revalidation. No diagnostic token hash, build-log route, or compute-worker build observer is part of the intended steady-state admin production surface.
