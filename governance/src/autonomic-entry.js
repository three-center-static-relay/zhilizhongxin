import app from "./admin-entry.js";
export {AdminState} from "./admin-entry.js";

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
async function readBoundedJson(request){const raw=await request.text();if(new TextEncoder().encode(raw).length>32768)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});const body=raw?JSON.parse(raw):{};if(!body||typeof body!=="object"||Array.isArray(body))throw Object.assign(new Error("INVALID_REQUEST"),{status:400});return body}
function safeId(value){return String(value||crypto.randomUUID()).replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,120)}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="POST"&&url.pathname==="/_internal/autonomic-maintenance/enqueue"){
      if(url.hostname!=="governance.internal")return json({ok:false,error:"POLICY_DENIED"},403);
      if(!env.MAINTENANCE_CENTER?.fetch)return json({ok:false,error:"MAINTENANCE_CENTER_UNBOUND"},503);
      try{
        const body=await readBoundedJson(request);const incident_id=safeId(body.incident_id);
        const response=await env.MAINTENANCE_CENTER.fetch(new Request("https://maintenance.internal/v1/maintenance/autonomic",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({incident_id,receipt:body.receipt||{}})}));
        const result=await response.json().catch(()=>null);
        return json({ok:response.ok,incident_id,transport:"maintenance-service-binding",primary_model:"@cf/nvidia/nemotron-3-120b-a12b",maintenance:result,paid_budget_usd:0,production_mutation:false},response.ok?202:response.status);
      }catch(error){return json({ok:false,error:String(error?.message||"MAINTENANCE_DISPATCH_FAILED")},error?.status||502)}
    }
    return app.fetch(request,env,ctx);
  }
};
