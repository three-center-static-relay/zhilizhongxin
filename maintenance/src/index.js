// cloudflare-route-verification: maintenance
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ok:true,service:"maintenance-worker",source:"github-static-relay"});
    return Response.json({service:"maintenance-worker",status:"ready"});
  }
};
