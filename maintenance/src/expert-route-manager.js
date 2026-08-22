import {buildExpertRoutePlan as buildBaseExpertRoutePlan,refreshExpertRoutes as refreshBaseExpertRoutes} from "./expert-route-manager-base.js";

const CF_API="https://api.cloudflare.com/client/v4";
const MAX_LANES=8;
const MAX_SHARD_LANES=2;
const MAX_SHARD_ELEMENTS=16;
const GATEWAY_MODEL_RETRIES=0;
const GATEWAY_MODEL_TIMEOUT_MS=45000;
const RUNTIME_MIN_SAMPLES=3;
const RUNTIME_MAX_SUCCESS_RATE=0.34;
const RUNTIME_MIN_TIMEOUTS=2;

function clean(v){return String(v??"").trim()}
function norm(v){return clean(v).toLowerCase().replace(/[_\s]+/g,"-")}
function num(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d}
function providerKey(c){return`${norm(c?.provider)}::${clean(c?.model).toLowerCase()}`}
function credentials(env){const accountId=clean(env?.CF_ACCOUNT_ID||env?.CLOUDFLARE_ACCOUNT_ID),token=clean(env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN||env?.CF_API_TOKEN),gatewayId=clean(env?.AI_GATEWAY_ID||"test");return{accountId,token,gatewayId}}
function rowsOf(payload,key){const d=payload?.result??payload?.data??payload??null;if(Array.isArray(d))return d;if(Array.isArray(d?.[key]))return d[key];if(Array.isArray(payload?.[key]))return payload[key];return[]}

async function runtimeTelemetry(env,fetchImpl=fetch){
  const c=credentials(env);if(!c.accountId||!c.token||!c.gatewayId)return{readable:false,samples:0,quarantine:new Set(),stats:new Map()};
  const stats=new Map();let samples=0;
  for(let page=1;page<=4;page++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);let response,payload;
    try{
      response=await fetchImpl(`${CF_API}/accounts/${encodeURIComponent(c.accountId)}/ai-gateway/gateways/${encodeURIComponent(c.gatewayId)}/logs?per_page=50&page=${page}&order_by=created_at&order_by_direction=desc`,{headers:{authorization:`Bearer ${c.token}`,accept:"application/json"},signal:controller.signal});
      payload=await response.json().catch(()=>null);
    }catch{return{readable:false,samples,quarantine:new Set(),stats}}finally{clearTimeout(timer)}
    if(!response?.ok||payload?.success===false)return{readable:false,samples,quarantine:new Set(),stats};
    const rows=rowsOf(payload,"logs");
    for(const row of rows){
      samples++;
      const model=clean(row?.model),provider=norm(row?.provider||row?.provider_name);if(!model||!provider)continue;
      const status=Number(row?.status_code||row?.status||0),success=row?.success===true||(status>=200&&status<400),text=JSON.stringify([row?.error,row?.message,row?.description,row?.internal_code,row?.internalCode]).toLowerCase(),timeout=status===504||text.includes("timeout")||text.includes("2014"),server=status>=500&&status<600,key=`${provider}::${model.toLowerCase()}`,s=stats.get(key)||{n:0,ok:0,timeout:0,server:0};
      s.n++;if(success)s.ok++;if(timeout)s.timeout++;if(server)s.server++;stats.set(key,s);
    }
    if(rows.length<50)break;
  }
  const quarantine=new Set();
  for(const[key,s]of stats){const rate=s.n?s.ok/s.n:1;if(s.timeout>=RUNTIME_MIN_TIMEOUTS||(s.n>=RUNTIME_MIN_SAMPLES&&s.server>=2&&rate<RUNTIME_MAX_SUCCESS_RATE))quarantine.add(key)}
  return{readable:true,samples,quarantine,stats};
}

function routeShards(laneCount){const out=[];const count=Math.max(1,Math.min(MAX_LANES,Math.trunc(Number(laneCount)||1)));for(let min=1;min<=count;min+=MAX_SHARD_LANES){const max=Math.min(MAX_LANES,min+MAX_SHARD_LANES-1),key=`lanes-${min}-${max}`;out.push({key,name:`expert-panel-${key}-v1`,min,max})}return out}
function distinctPick(list,used=[],preferDifferentProvider=false){const available=list.filter(c=>!used.some(u=>providerKey(u)===providerKey(c)));if(preferDifferentProvider&&available.length){const usedProviders=new Set(used.map(x=>norm(x?.provider)).filter(Boolean)),cross=available.find(c=>!usedProviders.has(norm(c.provider)));if(cross)return cross}return available[0]||list[0]||null}
function node(id,candidate,fallback){return{id,type:"model",properties:{provider:candidate.provider,model:candidate.model,timeout:GATEWAY_MODEL_TIMEOUT_MS,retries:GATEWAY_MODEL_RETRIES},outputs:{success:{elementId:"end"},fallback:{elementId:fallback||"end"}}}}
function qualityCondition(){return{$or:[{"metadata.cost_mode":{"$eq":"quality-first"}},{"metadata.depth":{"$eq":"deep"}},{"metadata.stage":{"$in":["planner","judge"]}},{"metadata.capability":{"$in":["legal","medical","finance","quantitative","coding","risk","adversarial"]}}]}}
function addLane(elements,lane,nextId,prefix){const quality=distinctPick(lane.quality),reserve=distinctPick(lane.quality,[quality],true)||quality,balanced=distinctPick(lane.balanced,[quality,reserve],true)||quality,free=distinctPick(lane.free,[quality,reserve,balanced],true)||balanced;if(!quality||!balanced||!reserve||!free)throw new Error("MODEL_RUNTIME_QUARANTINE_EMPTIED_LANE");const n=lane.lane,q=`${prefix}_m_${n}_q`,r=`${prefix}_m_${n}_r`,b=`${prefix}_m_${n}_b`,f=`${prefix}_m_${n}_f`,cq=`${prefix}_c_${n}_q`,cf=`${prefix}_c_${n}_f`,lc=`${prefix}_lane_${n}`;elements.push(node(r,reserve,"end"),node(q,quality,r),node(b,balanced,q),node(f,free,b),{id:cq,type:"conditional",properties:{conditions:qualityCondition()},outputs:{true:{elementId:q},false:{elementId:b}}},{id:cf,type:"conditional",properties:{conditions:{"metadata.cost_mode":{"$eq":"free-first"}}},outputs:{true:{elementId:f},false:{elementId:cq}}},{id:lc,type:"conditional",properties:{conditions:{"metadata.lane":{"$eq":n}}},outputs:{true:{elementId:cf},false:{elementId:nextId}}})}
function validateShard(elements,route,lanes){if(lanes.length<1||lanes.length>MAX_SHARD_LANES)throw new Error("EXPERT_ROUTE_SHARD_LANE_BUDGET_EXCEEDED");if(elements.length>MAX_SHARD_ELEMENTS)throw new Error("EXPERT_ROUTE_SHARD_ELEMENT_BUDGET_EXCEEDED");const ids=new Set(elements.map(x=>x.id));for(const e of elements)for(const out of Object.values(e.outputs||{}))if(out?.elementId&&!ids.has(out.elementId))throw new Error("EXPERT_ROUTE_DANGLING_REFERENCE");return{element_count:elements.length,model_count:elements.filter(x=>x.type==="model").length,conditional_count:elements.filter(x=>x.type==="conditional").length,lane_count:lanes.length}}
function buildRouteShard(shard,allLanes){const lanes=allLanes.filter(x=>{const n=Number(x.lane);return n>=shard.min&&n<=shard.max});if(!lanes.length)return null;const prefix=shard.key.replace(/[^a-z0-9_-]/gi,"_"),first=lanes[0].lane,elements=[{id:"start",type:"start",outputs:{next:{elementId:`${prefix}_lane_${first}`}}},{id:"end",type:"end",outputs:{}}];for(let i=0;i<lanes.length;i++)addLane(elements,lanes[i],i<lanes.length-1?`${prefix}_lane_${lanes[i+1].lane}`:"end",prefix);return{routeKey:shard.key,routeName:shard.name,lane_min:shard.min,lane_max:shard.max,lanes:lanes.map(x=>x.lane),elements,...validateShard(elements,shard.name,lanes)}}
async function digest(value){const bytes=new TextEncoder().encode(JSON.stringify(value)),hash=await crypto.subtle.digest("SHA-256",bytes);return[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("")}

function filterLane(lane,quarantine){const keep=c=>!quarantine.has(providerKey(c)),candidates=lane.candidates.filter(keep),quality=lane.quality.filter(keep),balanced=lane.balanced.filter(keep),free=lane.free.filter(keep);if(!candidates.length||!quality.length||!balanced.length)throw new Error("MODEL_RUNTIME_QUARANTINE_EMPTIED_LANE");return{...lane,candidates,quality,balanced,free,provider_count:new Set(candidates.map(x=>norm(x.provider))).size}}

export async function buildExpertRoutePlan(env={},fetchImpl=fetch){
  const base=await buildBaseExpertRoutePlan(env,fetchImpl),telemetry=await runtimeTelemetry(env,fetchImpl),quarantine=telemetry.quarantine;
  if(!telemetry.readable||quarantine.size===0){
    const summary={...base.summary,model_runtime_quarantine:true,runtime_quarantine_count:0,runtime_quarantine_samples:telemetry.samples,runtime_quarantine_reason:telemetry.readable?"NO_REPEAT_RUNTIME_FAILURE":"TELEMETRY_UNAVAILABLE"};
    return{...base,summary,plan_digest:await digest({...summary,routing_fingerprint:base.routing_fingerprint})};
  }
  const routeCandidates=base.routeCandidates.filter(c=>!quarantine.has(providerKey(c))),lanes=base.lanes.map(l=>filterLane(l,quarantine)),routes=routeShards(lanes.length).map(shard=>buildRouteShard(shard,lanes)).filter(Boolean),routingFingerprint=await digest(routes.map(r=>({routeName:r.routeName,elements:r.elements}))),summary={...base.summary,schema:"expert-route-plan-v10-runtime-health",provider_execution_policy:"ai-gateway-provider-config-plus-live-health-plus-model-terminal-quarantine-plus-model-runtime-quarantine",model_runtime_quarantine:true,runtime_quarantine_count:quarantine.size,runtime_quarantine_samples:telemetry.samples,runtime_quarantine_policy:"timeouts>=2 OR samples>=3-and-server-failures>=2-and-success-rate<0.34",candidate_count:routeCandidates.length,company_count:new Set(routeCandidates.map(x=>x.company)).size,lanes:lanes.map(l=>({lane:l.lane,company:l.company,candidate_count:l.candidates.length,provider_count:l.provider_count,providers:[...new Set(l.candidates.map(x=>x.provider))]})),routes:routes.map(r=>({route_name:r.routeName,lane_min:r.lane_min,lane_max:r.lane_max,lanes:r.lanes,element_count:r.element_count,model_count:r.model_count,conditional_count:r.conditional_count}))};
  return{...base,routeCandidates,lanes,routes,summary,routing_fingerprint:routingFingerprint,plan_digest:await digest({...summary,routing_fingerprint:routingFingerprint})};
}

export async function refreshExpertRoutes(env={},fetchImpl=fetch,preparedPlan=null){const plan=preparedPlan||await buildExpertRoutePlan(env,fetchImpl),receipt=await refreshBaseExpertRoutes(env,fetchImpl,plan);return{...receipt,schema:"expert-route-refresh-v10-runtime-health",provider_execution_policy:plan.summary?.provider_execution_policy||receipt.provider_execution_policy,model_runtime_quarantine:true,runtime_quarantine_count:Number(plan.summary?.runtime_quarantine_count||0),runtime_quarantine_samples:Number(plan.summary?.runtime_quarantine_samples||0)}}
