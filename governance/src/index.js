// cloudflare-route-verification: governance
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "governance-worker", source: "github-static-relay" });
    }
    return Response.json({ service: "governance-worker", status: "ready" });
  }
};
