const CAPABILITY_PATH="/__runtime-canary/v5-receipt/yfs-Gwn6OLN79vYCN5PLOOOGKDcg_VNK-2AH4ldtYPo";
const EXPIRES_AT=Date.parse("2026-08-22T01:20:00.000Z");
const TARGET_TASK_ID="runtime-canary-adaptive-effect-v5";
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
export async function handleV5ReceiptRecovery(request,env){
  const url=new URL(request.url);
  if(url.pathname!==CAPABILITY_PATH)return null;
  if(request.method!=="GET"||Date.now()>EXPIRES_AT)return json({ok:false,error:"NOT_FOUND"},404);
  if(!env.ADMIN_COORDINATOR?.get||!env.ADMIN_COORDINATOR?.idFromName)return json({ok:false,error:"STATE_UNAVAILABLE"},503);
  const state=env.ADMIN_COORDINATOR.get(env.ADMIN_COORDINATOR.idFromName("global"));
  const response=await state.fetch(new Request(`https://state.internal/task/${encodeURIComponent(TARGET_TASK_ID)}`,{method:"GET"}));
  const body=await response.json().catch(()=>null);
  if(!response.ok)return json({ok:false,error:"STATE_READ_FAILED",http_status:response.status},502);
  return json({ok:true,target:TARGET_TASK_ID,task:body?.task||null,expires_at:new Date(EXPIRES_AT).toISOString(),read_only:true,secrets_redacted:true});
}
