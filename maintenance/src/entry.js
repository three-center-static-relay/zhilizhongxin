import { WorkerEntrypoint } from "cloudflare:workers";
import maintenance, { MaintenanceState } from "./index.js";
import { refreshExpertRoute } from "./expert-route-manager.js";

export { MaintenanceState };
export default maintenance;

const REQUEST_ID=/^[A-Za-z0-9._:-]{1,128}$/;
const JSON_HEADERS={"content-type":"application/json;charset=utf-8","cache-control":"no-store"};
const CF_API="https://api.cloudflare.com/client/v4";
const SHARDS=["plan","general","code","regulated","research","strategy","creative"];
const versionId=env=>String(env.CF_VERSION_METADATA?.id||"").trim()||null;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});

function authorizeControl(ctx){
  const props=ctx?.props||{};
  if(props.caller!=="admin-worker"||props.capability!=="expert-route-refresh")throw new Error("RPC_CALLER_NOT_AUTHORIZED");
}
function requestId(value){const id=String(value||"").trim();if(!REQUEST_ID.test(id))throw new Error("INVALID_REQUEST_ID");return id}
async function readJson(response){return await response.json().catch(()=>null)}
function store(env){return env.MAINTENANCE_STATE.get(env.MAINTENANCE_STATE.idFromName("global"))}
async function stateCall(env,path,method="GET",data){
  const init={method,headers:{"content-type":"application/json"}};
  if(data!==undefined)init.body=JSON.stringify(data);
  const response=await store(env).fetch(new Request(`https://state.internal${path}`,init));
  const body=await response.json().catch(()=>({ok:false,error:"STATE_BAD_RESPONSE"}));
  if(!response.ok||body?.ok===false)throw Object.assign(new Error(body?.error||"STATE_ERROR"),{status:response.status,details:body});
  return body;
}
function routeNames(env){
  const base=String(env.AI_GATEWAY_ROUTE||"expert-panel-v1").trim();
  const family=String(env.AI_GATEWAY_ROUTE_FAMILY||base.replace(/-v\d+$/i,"")||"expert-panel").trim();
  return[base,...SHARDS.map(shard=>`${family}-${shard}-v1`)];
}
function controlConfig(env){
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||"").trim(),token=String(env.CLOUDFLARE_AI_GATEWAY_API_TOKEN||"").trim(),gatewayId=String(env.AI_GATEWAY_ID||"test").trim();
  if(!accountId||!token||!gatewayId)throw new Error("EXPERT_ROUTE_CONTROL_PLANE_NOT_CONFIGURED");
  return{accountId,token,gatewayId};
}
async function cf(env,path,{method="GET",body}={}){
  const c=controlConfig(env);
  const response=await fetch(`${CF_API}/accounts/${encodeURIComponent(c.accountId)}/ai-gateway/gateways/${encodeURIComponent(c.gatewayId)}${path}`,{
    method,
    headers:{authorization:`Bearer ${c.token}`,accept:"application/json",...(body===undefined?{}:{"content-type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok||payload?.success===false)throw Object.assign(new Error("CLOUDFLARE_API_ERROR"),{status:response.status,details:{errors:payload?.errors||null,messages:payload?.messages||null}});
  return payload?.result??payload?.data??payload;
}
function listRoutes(payload){return payload?.routes||payload?.data?.routes||(Array.isArray(payload)?payload:[])}
async function routeSnapshot(env){
  const wanted=new Set(routeNames(env)),payload=await cf(env,"/routes?per_page=100"),map=new Map();
  for(const route of listRoutes(payload)){
    const name=String(route?.name||"");
    if(!wanted.has(name))continue;
    map.set(name,{route_id:String(route?.id||""),version_id:String(route?.deployment?.version_id||"")||null});
  }
  return map;
}
function snapshotReceipt(snapshot){return[...snapshot.entries()].map(([route_name,v])=>({route_name,...v})).sort((a,b)=>a.route_name.localeCompare(b.route_name))}
async function deployRouteVersion(env,routeId,versionId){await cf(env,`/routes/${encodeURIComponent(routeId)}/deployments`,{method:"POST",body:{version_id:versionId}})}
async function deleteRoute(env,routeId){await cf(env,`/routes/${encodeURIComponent(routeId)}`,{method:"DELETE"})}
async function restoreSnapshot(env,before){
  const current=await routeSnapshot(env),actions=[];
  for(const name of routeNames(env)){
    const prior=before.get(name)||null,now=current.get(name)||null;
    if(prior){
      if(!prior.route_id||!prior.version_id){actions.push({route_name:name,ok:false,error:"PRETEST_SNAPSHOT_INCOMPLETE"});continue}
      if(!now){actions.push({route_name:name,ok:false,error:"PRETEST_ROUTE_DISAPPEARED"});continue}
      if(now.route_id!==prior.route_id){actions.push({route_name:name,ok:false,error:"ROUTE_ID_CHANGED"});continue}
      if(now.version_id!==prior.version_id){
        try{await deployRouteVersion(env,prior.route_id,prior.version_id);actions.push({route_name:name,ok:true,action:"restore-version",version_id:prior.version_id})}
        catch(error){actions.push({route_name:name,ok:false,error:String(error?.message||error)})}
      }else actions.push({route_name:name,ok:true,action:"unchanged"});
    }else if(now){
      try{await deleteRoute(env,now.route_id);actions.push({route_name:name,ok:true,action:"delete-created-route",route_id:now.route_id})}
      catch(error){actions.push({route_name:name,ok:false,error:String(error?.message||error)})}
    }else actions.push({route_name:name,ok:true,action:"absent"});
  }
  const after=await routeSnapshot(env),mismatches=[];
  for(const name of routeNames(env)){
    const a=before.get(name)||null,b=after.get(name)||null;
    if(Boolean(a)!==Boolean(b)||a?.route_id!==b?.route_id||a?.version_id!==b?.version_id)mismatches.push({route_name:name,before:a,after:b});
  }
  return{ok:actions.every(x=>x.ok)&&mismatches.length===0,actions,mismatches,restored_snapshot:snapshotReceipt(after)};
}

async function runPersistentRefresh(env,ctx,value,transport){
  const id=requestId(value),nonce=crypto.randomUUID().replace(/-/g,""),triggerId=`${transport}:${id}`,controlEnv={...env,IMMEDIATE_REFRESH_ENABLED:"true",IMMEDIATE_REFRESH_ID:triggerId,IMMEDIATE_REFRESH_NONCE:nonce};
  const response=await maintenance.fetch(new Request("https://maintenance.internal/v1/maintenance/refresh-now",{method:"POST",headers:{accept:"application/json","x-immediate-refresh-nonce":nonce}}),controlEnv,ctx);
  const body=await readJson(response);
  return{ok:response.ok&&body?.ok===true,http_status:response.status,request_id:id,transport,maintenance_version:versionId(env),result:body?.result||null,error:body?.error||null,secrets_redacted:true};
}
async function runL2Rehearsal(env,ctx,value){
  const id=requestId(value),owner=`l2:${id}:${Date.now()}`;
  let acquired=false,before=null,result=null,rollback=null;
  try{
    await stateCall(env,"/acquire","POST",{owner});acquired=true;
    before=await routeSnapshot(env);
    for(const [name,snapshot] of before){if(!snapshot.route_id||!snapshot.version_id)throw new Error(`PRETEST_SNAPSHOT_INCOMPLETE:${name}`)}
    try{result=await refreshExpertRoute(env,{previous:null,expertBinding:env.EXPERT_CENTER})}
    catch(error){result={ok:false,status:"error",error:String(error?.message||error),details:error?.details||null,secrets_redacted:true}}
    rollback=await restoreSnapshot(env,before);
    const active=result?.ok===true&&result?.status==="active";
    return{
      ok:active&&rollback.ok,
      http_status:active&&rollback.ok?200:502,
      request_id:id,
      transport:"fetch",
      maintenance_version:versionId(env),
      forced_refresh:true,
      result,
      rollback_rehearsal:{ok:rollback.ok,pretest_snapshot:snapshotReceipt(before),...rollback},
      secrets_redacted:true
    };
  }finally{
    if(acquired)await stateCall(env,"/release","POST",{owner}).catch(()=>{});
  }
}
async function latestRoute(env,ctx,transport){
  const response=await maintenance.fetch(new Request("https://maintenance.internal/v1/maintenance/expert-route/latest",{method:"GET",headers:{accept:"application/json"}}),env,ctx),body=await readJson(response);
  return{ok:response.ok&&body?.ok===true,http_status:response.status,transport,maintenance_version:versionId(env),expert_route:body?.expert_route||null,error:body?.error||null,secrets_redacted:true};
}

export class MaintenanceControl extends WorkerEntrypoint{
  async fetch(request){
    authorizeControl(this.ctx);
    const url=new URL(request.url);
    if(request.method==="POST"&&url.pathname==="/v1/control/expert-route/refresh"){
      const body=await request.json().catch(()=>({}));
      try{const receipt=await runL2Rehearsal(this.env,this.ctx,body.request_id);return json(receipt,receipt.ok?200:receipt.http_status||502)}
      catch(error){return json({ok:false,error:String(error?.message||error),maintenance_version:versionId(this.env),secrets_redacted:true},error?.status||502)}
    }
    if(request.method==="GET"&&url.pathname==="/v1/control/expert-route/latest"){
      const receipt=await latestRoute(this.env,this.ctx,"fetch");return json(receipt,receipt.ok?200:502);
    }
    return json({ok:false,error:"NOT_FOUND",secrets_redacted:true},404);
  }
  async refreshExpertRoute(value){authorizeControl(this.ctx);return await runPersistentRefresh(this.env,this.ctx,value,"rpc")}
  async latestExpertRoute(){authorizeControl(this.ctx);return await latestRoute(this.env,this.ctx,"rpc")}
}
