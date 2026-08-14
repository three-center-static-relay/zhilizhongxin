// cloudflare-route-verification: admin
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ok:true,service:"admin-worker",source:"github-static-relay"});
    return Response.json({service:"admin-worker",status:"ready"});
  }
};
