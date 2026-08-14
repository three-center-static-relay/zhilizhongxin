// cloudflare-route-verification: admin-v2
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ok:true,service:"admin-worker",source:"github-static-relay",route_test:"admin-v2"});
    return Response.json({service:"admin-worker",status:"ready"});
  }
};
