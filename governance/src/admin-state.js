const MAX_BODY_BYTES=32768;
const MAX_CANDIDATES=50;
const MAX_ACCEPTANCES=100;
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

async function parseBody(request){
  const declared=Number(request.headers.get("content-length")||0);
  if(declared>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  const text=await request.text();
  if(new TextEncoder().encode(text).length>MAX_BODY_BYTES)throw Object.assign(new Error("BODY_TOO_LARGE"),{status:413});
  if(!text)return{};
  try{return JSON.parse(text)}catch{throw Object.assign(new Error("INVALID_REQUEST"),{status:400})}
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
      if(request.method==="POST"&&url.pathname==="/candidate"){
        const body=await parseBody(request),id=String(body?.candidate_id||"");
        if(!id||!body?.record||typeof body.record!=="object")return json({ok:false,error:"INVALID_REQUEST"},400);
        const key=`candidate:${id}`;
        if(await storage.get(key))return json({ok:false,error:"CANDIDATE_ALREADY_EXISTS"},409);
        await storage.put(key,body.record);
        await boundedAppend(storage,"index:candidates",id,MAX_CANDIDATES,"candidate:");
        return json({ok:true,candidate:body.record},201);
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
        return json({ok:true,acceptance:body.record},201);
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
