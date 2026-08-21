import {discoverWorkersAI} from "./model-universe.js";
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const safe=v=>String(v??"UNKNOWN").replace(/[^0-9A-Za-z_.:/-]/g,"_").slice(0,180);
function auth(request,env){const a=String(env.MAINTENANCE_RUNTIME_E2E_PROBE||""),b=String(request.headers.get("x-maintenance-e2e-probe")||"");if(!a||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
export default{async fetch(request,env){if(!auth(request,env))return json({ok:false,error:"NOT_FOUND"},404);try{const rows=await discoverWorkersAI(env),companies=new Set(rows.map(x=>x.company).filter(Boolean)),ok=rows.length>0&&companies.size>=2;return json({ok,stage:"workers-ai-live-catalog",candidate_count:rows.length,company_count:companies.size,secrets_redacted:true},ok?200:502)}catch(e){return json({ok:false,stage:"workers-ai-live-catalog",error:safe(e?.message||e),secrets_redacted:true},502)}}};
export class MaintenanceState{constructor(state){this.state=state}async fetch(){return json({ok:true,diagnostic_only:true})}}
