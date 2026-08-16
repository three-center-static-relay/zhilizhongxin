const MAX_BODY_BYTES=32768;
const MAX_CANDIDATES=50;
const MAX_ACCEPTANCES=100;
const MAX_OPERATION_LEASE_SECONDS=300;
const OPERATION_LOCK_KEY="admin:operation-lock";
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

async function parseBody(request){
  const declared=Number(request.headers.get("content-length")||0);
  if(declared>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  const text=await request.text();
  if(new TextEncoder().encode(text).length>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  if(!text)return{};
  try{return JSON.parse(text)}catch{throw Object.assign(new Error("INVALID_REQUEST"),{status:400})}
}
function boundedInt(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback}
async function activeOperation(storage){
  const active=await storage.get(OPERATION_LOCK_KEY)||null;
  if(active&&Number(active.expires_at_ms||0)<=Date.now()){await storage.delete(OPERATION_LOCK_KEY);return null;}
  return active;
}
async function releaseIfKind(storage,kind){
  const active=await activeOperation(storage);
  if(active&&String(active.kind||"")===kind){await storage.delete(OPERATION_LOCK_KEY);return true;}
  return false;
}
async function boundedAppend(storage,indexKey,id,limit,prefix){
  const old=await storage.get(indexKey)||[];
  const next=[id,...old.filter(x=>x!==id)].slice(0,limit);
  const evicted=old.filter(x=>!next.includes(x));
  await storage.put(indexKey,next);
  for(const x of evicted)await storage.delete(`${prefix}${x}`);
}

export class AdminState{
  constructor(state,env){this.state=state;this.env=env}
  async fetch(request){
    try{
      const url=new URL(request.url),storage=this.state.storage;
      if(request.method==="GET"&&url.pathname==="/operation-lock")return json({ok:true,active:await activeOperation(storage)});
      if(request.method==="POST"&&url.pathname==="/operation-lock/acquire"){
        const body=await parseBody(request),owner=String(body?.owner||""),kind=String(body?.kind||"admin-operation");
        if(!owner||owner.length>200||!kind||kind.length>120)return json({ok:false,error:"INVALID_REQUEST"},400);
        const active=await activeOperation(storage);
        if(active)return json({ok:false,error:"ADMIN_OPERATION_BUSY",active},409);
        const leaseSeconds=boundedInt(body?.lease_seconds,120,10,MAX_OPERATION_LEASE_SECONDS);
        const record={owner,kind,acquired_at:new Date().toISOString(),expires_at_ms:Date.now()+leaseSeconds*1000,lease_seconds:leaseSeconds};
        await storage.put(OPERATION_LOCK_KEY,record);
        return json({ok:true,active:record},200);
      }
      if(request.method==="POST"&&url.pathname==="/operation-lock/release"){
        const body=await parseBody(request),owner=String(body?.owner||"");
        if(!owner)return json({ok:false,error:"INVALID_REQUEST"},400);
        const active=await activeOperation(storage);
        if(!active)return json({ok:true,released:false},200);
        if(String(active.owner)!==owner)return json({ok:false,error:"ADMIN_OPERATION_LOCK_OWNER_MISMATCH",active},409);
        await storage.delete(OPERATION_LOCK_KEY);
        return json({ok:true,released:true},200);
      }
      if(request.method==="POST"&&url.pathname==="/candidate"){
        const body=await parseBody(request),id=String(body?.candidate_id||"");
        if(!id||!body?.record||typeof body.record!=="object")return json({ok:false,error:"INVALID_REQUEST"},400);
        const key=`candidate:${id}`;
        if(await storage.get(key))return json({ok:false,error:"CANDIDATE_ALREADY_EXISTS"},409);
        await storage.put(key,body.record);
        await boundedAppend(storage,"index:candidates",id,MAX_CANDIDATES,"candidate:");
        const operation_lock_released=await releaseIfKind(storage,"candidate-build");
        return json({ok:true,candidate:body.record,operation_lock_released},201);
      }
      let match=url.pathname.match(/^\/candidate\/([^/]+)$/);
      if(request.method==="GET"&&match){
        const id=decodeURIComponent(match[1]),record=await storage.get(`candidate:${id}`)||null;
        return record?json({ok:true,candidate:record}):json({ok:false,error:"CANDIDATE_NOT_FOUND"},404);
      }
      if(request.method==="POST"&&url.pathname==="/acceptance"){
        const body=await parseBody(request),runId=String(body?.run_id||""),candidateId=String(body?.candidate_id||"");
        if(!runId||!candidateId||!body?.record||typeof body.record!=="object")return json({ok:false,error:"INVALID_REQUEST"},400);
        const candidate=await storage.get(`candidate:${candidateId}`);
        if(!candidate)return json({ok:false,error:"CANDIDATE_NOT_FOUND"},404);
        const key=`acceptance:${runId}`;
        if(await storage.get(key))return json({ok:false,error:"ACCEPTANCE_ALREADY_EXISTS"},409);
        await storage.put(key,body.record);
        await boundedAppend(storage,"index:acceptances",runId,MAX_ACCEPTANCES,"acceptance:");
        await storage.put(`candidate:${candidateId}`,{
          ...candidate,
          status:String(body.record?.validation||"")==="PASS"?"validated-control-plane":"validation-failed",
          latest_acceptance_run_id:runId,
          latest_acceptance_validation:body.record?.validation||null,
          latest_acceptance_at:body.record?.completed_at||body.record?.observed_at||new Date().toISOString()
        });
        const operation_lock_released=await releaseIfKind(storage,"candidate-validation");
        return json({ok:true,acceptance:body.record,operation_lock_released},201);
      }
      match=url.pathname.match(/^\/acceptance\/([^/]+)$/);
      if(request.method==="GET"&&match){
        const runId=decodeURIComponent(match[1]),record=await storage.get(`acceptance:${runId}`)||null;
        return record?json({ok:true,acceptance:record}):json({ok:false,error:"ACCEPTANCE_NOT_FOUND"},404);
      }
      return json({ok:false,error:"ADMIN_STATE_ROUTE_NOT_FOUND"},404);
    }catch(error){return json({ok:false,error:String(error?.message||"ADMIN_STATE_FAILED")},error?.status||500)}
  }
}
