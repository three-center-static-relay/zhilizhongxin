const CAPABILITY_PATH="/__runtime-canary/v5-receipt/yfs-Gwn6OLN79vYCN5PLOOOGKDcg_VNK-2AH4ldtYPo";
const EXPIRES_AT=Date.parse("2026-08-22T01:20:00.000Z");
const TARGET_TASK_ID="runtime-canary-adaptive-effect-v5";
const EXPERT_TASK_ID="runtime-adaptive-adaptive-effect-v5-expert";
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
export async function handleV5ReceiptRecovery(request,env){
  const url=new URL(request.url);
  if(url.pathname!==CAPABILITY_PATH)return null;
  if(request.method!=="GET"||Date.now()>EXPIRES_AT)return json({ok:false,error:"NOT_FOUND"},404);
  if(!env.ADMIN_COORDINATOR?.get||!env.ADMIN_COORDINATOR?.idFromName)return json({ok:false,error:"STATE_UNAVAILABLE"},503);
  const state=env.ADMIN_COORDINATOR.get(env.ADMIN_COORDINATOR.idFromName("global"));
  const adminResponse=await state.fetch(new Request(`https://state.internal/task/${encodeURIComponent(TARGET_TASK_ID)}`,{method:"GET"}));
  const adminBody=await adminResponse.json().catch(()=>null);
  if(!adminResponse.ok)return json({ok:false,error:"STATE_READ_FAILED",http_status:adminResponse.status},502);
  let expert={ok:false,error:"EXPERT_STATUS_UNAVAILABLE"};
  if(env.EXPERT_CENTER?.fetch){
    const r=await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/status",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({task_id:EXPERT_TASK_ID})}));
    const b=await r.json().catch(()=>null);
    expert={http_status:r.status,...(b||{ok:false,error:"EXPERT_STATUS_BAD_JSON"})};
  }
  return json({ok:true,target:TARGET_TASK_ID,expert_target:EXPERT_TASK_ID,task:adminBody?.task||null,expert,expires_at:new Date(EXPIRES_AT).toISOString(),read_only:true,secrets_redacted:true});
}
