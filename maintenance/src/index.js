// cloudflare-deploy-refresh: 2026-08-14T22:01+08:00
// cloudflare-route-verification: maintenance-v2
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ok:true,service:"maintenance-worker",source:"github-static-relay",route_test:"maintenance-v2"});
    return Response.json({service:"maintenance-worker",status:"ready"});
  }
};
