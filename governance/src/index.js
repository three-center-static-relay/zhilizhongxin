// cloudflare-route-verification: governance-v2
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "governance-worker", source: "github-static-relay", route_test: "governance-v2" });
    }
    return Response.json({ service: "governance-worker", status: "ready" });
  }
};
