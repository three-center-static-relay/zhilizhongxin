import app from "./admin-entry.js";
export {AdminState} from "./admin-entry.js";
export {AutonomicMaintenanceWorkflow} from "./maintenance-workflow.js";

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
async function readBoundedJson(request){const raw=await request.text();if(new TextEncoder().encode(raw).length>32768)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});const body=raw?JSON.parse(raw):{};if(!body||typeof body!=="object"||Array.isArray(body))throw Object.assign(new Error("INVALID_REQUEST"),{status:400});return body}
function safeId(value){return String(value||crypto.randomUUID()).replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,120)}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="POST"&&url.pathname==="/_internal/autonomic-maintenance/enqueue"){
      if(url.hostname!=="governance.internal")return json({ok:false,error:"POLICY_DENIED"},403);
      if(!env.MAINTENANCE_QUEUE?.send)return json({ok:false,error:"MAINTENANCE_QUEUE_UNBOUND"},503);
      try{const body=await readBoundedJson(request);const incident_id=safeId(body.incident_id);await env.MAINTENANCE_QUEUE.send({incident_id,receipt:body.receipt||{},source:"governance",paid_budget_usd:0});return json({ok:true,incident_id,queued:true,paid_budget_usd:0,production_mutation:false},202)}catch(error){return json({ok:false,error:String(error?.message||"ENQUEUE_FAILED")},error?.status||400)}
    }
    return app.fetch(request,env,ctx);
  },
  async queue(batch,env){
    for(const message of batch.messages){
      try{
        const body=message.body&&typeof message.body==="object"?message.body:{};
        const incident_id=safeId(body.incident_id||message.id);
        if(!env.AUTONOMIC_MAINTENANCE?.create)throw new Error("MAINTENANCE_WORKFLOW_UNBOUND");
        await env.AUTONOMIC_MAINTENANCE.create({id:`incident-${incident_id}`,params:{receipt:body.receipt||{}}});
        message.ack();
      }catch(error){console.log(JSON.stringify({event:"autonomic-maintenance.queue-error",error:String(error?.message||error).slice(0,160),secrets_redacted:true}));message.retry({delaySeconds:30})}
    }
  }
};
