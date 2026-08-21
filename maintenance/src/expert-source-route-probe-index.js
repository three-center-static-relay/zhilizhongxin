const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
function auth(request,env){const a=String(env.MAINTENANCE_RUNTIME_E2E_PROBE||""),b=String(request.headers.get("x-maintenance-e2e-probe")||"");if(!a||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
export default{async fetch(request,env){if(!auth(request,env))return json({ok:false,error:"NOT_FOUND"},404);return json({ok:true,stage:"probe-baseline",secrets_redacted:true},200)}};
export class MaintenanceState{constructor(state){this.state=state}async fetch(){return json({ok:true,diagnostic_only:true})}}
