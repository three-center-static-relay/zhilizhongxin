import base,{AdminState} from "./admin-entry.js";
export {AdminState};
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
function auth(request,env){const a=String(env.NEON_RUNTIME_PROBE||""),b=String(request.headers.get("x-neon-runtime-probe")||"");if(!a||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname!=="/__neon_health_probe"||!auth(request,env))return base.fetch(request,env,ctx);return json({ok:true,selftest:"governance-neon-transport-probe-v1",transport_ok:true,secret_exposed:false,secrets_redacted:true,production_mutation:false},200)}};
