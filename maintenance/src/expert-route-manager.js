import {buildExpertRoutePlan as buildBaseExpertRoutePlan,refreshExpertRoutes as refreshBaseExpertRoutes} from "./expert-route-manager-base.js";

const CF_API="https://api.cloudflare.com/client/v4";
const MAX_LANES=8;
const MAX_SHARD_LANES=2;
const MAX_SHARD_ELEMENTS=16;
const GATEWAY_MODEL_RETRIES=0;
const GATEWAY_MODEL_TIMEOUT_MS=30000;
const RUNTIME_MIN_FAILURES=2;
const RUNTIME_MAX_SUCCESS_RATE=0.34;
const RUNTIME_MIN_TIMEOUTS=2;
const PROVIDER_MIN_FAILURES=3;
const PROVIDER_MIN_TIMEOUTS=2;
const PROVIDER_MIN_DISTINCT_MODELS=2;
const PROVIDER_MAX_SUCCESS_RATE=0.34;
const RUNTIME_QUARANTINE_WINDOW_MS=30*60*1000;

const clean=v=>String(v??"").trim();
const norm=v=>clean(v).toLowerCase().replace(/[_\s]+/g,"-");
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=v=>Math.max(0,Math.min(1,num(v,0.5)));
const providerKey=c=>`${norm(c?.provider)}::${clean(c?.model).toLowerCase()}`;

function credentials(env){
  return{
    accountId:clean(env?.CF_ACCOUNT_ID||env?.CLOUDFLARE_ACCOUNT_ID),
    token:clean(env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN||env?.CF_API_TOKEN),
    gatewayId:clean(env?.AI_GATEWAY_ID||"test")
  };
}
function rowsOf(p){const d=p?.result??p?.data??p;return Array.isArray(d)?d:Array.isArray(d?.logs)?d.logs:Array.isArray(p?.logs)?p.logs:[]}
function metadataOf(v){if(v&&typeof v==="object")return v;try{const x=JSON.parse(String(v||""));return x&&typeof x==="object"?x:{}}catch{return{}}}
function expertMeta(m){const lane=Number(m?.lane);return Boolean(clean(m?.stage)&&clean(m?.cost_mode)&&Number.isFinite(lane)&&lane>=1&&lane<=8)}
function terminalClient(status){return status>=400&&status<500&&![408,409,425,429].includes(status)}
function rowCreatedAtMs(row){const raw=row?.created_at??row?.createdAt??row?.timestamp??row?.created;const t=Date.parse(String(raw??""));return Number.isFinite(t)?t:null}

async function runtimeTelemetry(env,fetchImpl=fetch){
  const c=credentials(env);
  if(!c.accountId||!c.token||!c.gatewayId)return{
    readable:false,samples:0,expertSamples:0,expiredExpertSamples:0,quarantineWindowMs:RUNTIME_QUARANTINE_WINDOW_MS,fallbackSteps:0,fallbackSuccesses:0,
    quarantine:new Set(),stats:new Map(),providerQuarantine:new Set(),providerStats:new Map(),providerQuarantineDetails:[]
  };
  const stats=new Map(),providerStats=new Map(),cutoff=Date.now()-RUNTIME_QUARANTINE_WINDOW_MS;
  let samples=0,expertSamples=0,expiredExpertSamples=0,fallbackSteps=0,fallbackSuccesses=0;
  for(let page=1;page<=4;page++){
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);let r,p;
    try{
      r=await fetchImpl(`${CF_API}/accounts/${encodeURIComponent(c.accountId)}/ai-gateway/gateways/${encodeURIComponent(c.gatewayId)}/logs?per_page=50&page=${page}&order_by=created_at&order_by_direction=desc`,{headers:{authorization:`Bearer ${c.token}`,accept:"application/json"},signal:ctl.signal});
      p=await r.json().catch(()=>null);
    }catch{
      return{readable:false,samples,expertSamples,expiredExpertSamples,quarantineWindowMs:RUNTIME_QUARANTINE_WINDOW_MS,fallbackSteps,fallbackSuccesses,quarantine:new Set(),stats,providerQuarantine:new Set(),providerStats,providerQuarantineDetails:[]};
    }finally{clearTimeout(timer)}
    if(!r?.ok||p?.success===false)return{readable:false,samples,expertSamples,expiredExpertSamples,quarantineWindowMs:RUNTIME_QUARANTINE_WINDOW_MS,fallbackSteps,fallbackSuccesses,quarantine:new Set(),stats,providerQuarantine:new Set(),providerStats,providerQuarantineDetails:[]};
    const rows=rowsOf(p);
    for(const row of rows){
      samples++;
      const meta=metadataOf(row?.metadata);
      if(!expertMeta(meta))continue;
      const createdAt=rowCreatedAtMs(row);
      if(createdAt!==null&&createdAt<cutoff){expiredExpertSamples++;continue}
      expertSamples++;
      const model=clean(row?.model),provider=norm(row?.provider),status=Number(row?.status_code||0),success=row?.success===true,failed=row?.success===false||status>=400,step=Number(row?.step);
      if(Number.isFinite(step)&&step>0){fallbackSteps++;if(success)fallbackSuccesses++}
      if(provider){
        const ps=providerStats.get(provider)||{n:0,ok:0,fail:0,timeout:0,terminal:0,server:0,models:new Set()};
        ps.n++;if(success)ps.ok++;if(failed)ps.fail++;if(status===504)ps.timeout++;if(terminalClient(status))ps.terminal++;if(status>=500&&status<600)ps.server++;if(model)ps.models.add(model.toLowerCase());providerStats.set(provider,ps);
      }
      if(!model||!provider)continue;
      const key=`${provider}::${model.toLowerCase()}`,s=stats.get(key)||{n:0,ok:0,fail:0,timeout:0,terminal:0,server:0,fallback_step:0};
      s.n++;if(success)s.ok++;if(failed)s.fail++;if(status===504)s.timeout++;if(terminalClient(status))s.terminal++;if(status>=500&&status<600)s.server++;if(Number.isFinite(step)&&step>0)s.fallback_step++;stats.set(key,s);
    }
    if(rows.length<50)break;
  }
  const quarantine=new Set();
  for(const[key,s]of stats){
    const rate=s.n?s.ok/s.n:1;
    if(s.terminal>0||s.timeout>=RUNTIME_MIN_TIMEOUTS||(s.n>=RUNTIME_MIN_FAILURES&&s.fail>=RUNTIME_MIN_FAILURES&&rate<RUNTIME_MAX_SUCCESS_RATE))quarantine.add(key);
  }
  const providerQuarantine=new Set(),providerQuarantineDetails=[];
  for(const[provider,s]of providerStats){
    const rate=s.n?s.ok/s.n:1,distinctModels=s.models.size;
    const crossModelEvidence=distinctModels>=PROVIDER_MIN_DISTINCT_MODELS;
    const degraded=rate<PROVIDER_MAX_SUCCESS_RATE;
    const timeoutFault=crossModelEvidence&&degraded&&s.timeout>=PROVIDER_MIN_TIMEOUTS;
    const failureFault=crossModelEvidence&&degraded&&s.n>=PROVIDER_MIN_FAILURES&&s.fail>=PROVIDER_MIN_FAILURES;
    const terminalFault=crossModelEvidence&&degraded&&s.terminal>=PROVIDER_MIN_FAILURES;
    if(timeoutFault||failureFault||terminalFault){
      providerQuarantine.add(provider);
      providerQuarantineDetails.push({provider,sample_count:s.n,success_count:s.ok,failure_count:s.fail,timeout_count:s.timeout,terminal_count:s.terminal,distinct_model_count:distinctModels,success_rate:+rate.toFixed(4),reason:timeoutFault?"CROSS_MODEL_TIMEOUT_FAULT_DOMAIN":terminalFault?"CROSS_MODEL_TERMINAL_FAULT_DOMAIN":"CROSS_MODEL_FAILURE_FAULT_DOMAIN"});
    }
  }
  return{readable:true,samples,expertSamples,expiredExpertSamples,quarantineWindowMs:RUNTIME_QUARANTINE_WINDOW_MS,fallbackSteps,fallbackSuccesses,quarantine,stats,providerQuarantine,providerStats,providerQuarantineDetails};
}

function routeShards(n){const out=[],count=Math.max(1,Math.min(MAX_LANES,Math.trunc(Number(n)||1)));for(let min=1;min<=count;min+=MAX_SHARD_LANES){const max=Math.min(MAX_LANES,min+1),key=`lanes-${min}-${max}`;out.push({key,name:`expert-panel-${key}-v1`,min,max})}return out}
function distinctPick(list,used=[],preferProvider=false){const available=list.filter(c=>!used.some(u=>providerKey(u)===providerKey(c)));if(preferProvider&&available.length){const ps=new Set(used.map(x=>norm(x?.provider)).filter(Boolean)),x=available.find(c=>!ps.has(norm(c.provider)));if(x)return x}return available[0]||list[0]||null}
function node(id,c,fallback){return{id,type:"model",properties:{provider:c.provider,model:c.model,timeout:GATEWAY_MODEL_TIMEOUT_MS,retries:GATEWAY_MODEL_RETRIES},outputs:{success:{elementId:"end"},fallback:{elementId:fallback||"end"}}}}
function qualityCondition(){return{$or:[{"metadata.cost_mode":{"$eq":"quality-first"}},{"metadata.depth":{"$eq":"deep"}},{"metadata.stage":{"$in":["planner","judge"]}},{"metadata.capability":{"$in":["legal","medical","finance","quantitative","coding","risk","adversarial"]}}]}}
function addLane(elements,lane,next,prefix){const qv=distinctPick(lane.quality),rv=distinctPick(lane.quality,[qv],true)||qv,bv=distinctPick(lane.balanced,[qv,rv],true)||qv,fv=distinctPick(lane.free,[qv,rv,bv],true)||bv;if(!qv||!rv||!bv||!fv)throw new Error("MODEL_RUNTIME_QUARANTINE_EMPTIED_LANE");const n=lane.lane,q=`${prefix}_m_${n}_q`,r=`${prefix}_m_${n}_r`,b=`${prefix}_m_${n}_b`,f=`${prefix}_m_${n}_f`,cq=`${prefix}_c_${n}_q`,cf=`${prefix}_c_${n}_f`,lc=`${prefix}_lane_${n}`;elements.push(node(r,rv,"end"),node(q,qv,r),node(b,bv,q),node(f,fv,b),{id:cq,type:"conditional",properties:{conditions:qualityCondition()},outputs:{true:{elementId:q},false:{elementId:b}}},{id:cf,type:"conditional",properties:{conditions:{"metadata.cost_mode":{"$eq":"free-first"}}},outputs:{true:{elementId:f},false:{elementId:cq}}},{id:lc,type:"conditional",properties:{conditions:{"metadata.lane":{"$eq":n}}},outputs:{true:{elementId:cf},false:{elementId:next}}})}
function validateShard(elements,route,lanes){if(lanes.length<1||lanes.length>MAX_SHARD_LANES)throw new Error("EXPERT_ROUTE_SHARD_LANE_BUDGET_EXCEEDED");if(elements.length>MAX_SHARD_ELEMENTS)throw new Error("EXPERT_ROUTE_SHARD_ELEMENT_BUDGET_EXCEEDED");const ids=new Set(elements.map(x=>x.id));for(const e of elements)for(const out of Object.values(e.outputs||{}))if(out?.elementId&&!ids.has(out.elementId))throw new Error("EXPERT_ROUTE_DANGLING_REFERENCE");return{element_count:elements.length,model_count:elements.filter(x=>x.type==="model").length,conditional_count:elements.filter(x=>x.type==="conditional").length,lane_count:lanes.length}}
function buildRouteShard(shard,all){const lanes=all.filter(x=>Number(x.lane)>=shard.min&&Number(x.lane)<=shard.max);if(!lanes.length)return null;const prefix=shard.key.replace(/[^a-z0-9_-]/gi,"_"),elements=[{id:"start",type:"start",outputs:{next:{elementId:`${prefix}_lane_${lanes[0].lane}`}}},{id:"end",type:"end",outputs:{}}];for(let i=0;i<lanes.length;i++)addLane(elements,lanes[i],i<lanes.length-1?`${prefix}_lane_${lanes[i+1].lane}`:"end",prefix);return{routeKey:shard.key,routeName:shard.name,lane_min:shard.min,lane_max:shard.max,lanes:lanes.map(x=>x.lane),elements,...validateShard(elements,shard.name,lanes)}}
async function digest(v){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(v)));return[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("")}

function staticBaseScore(c){const h=c?.hints||{};return.40*clamp(h.quality)+.11*clamp(h.context)+.07*clamp(h.popularity)+.13*clamp(h.latency)+.11*clamp(h.throughput)+.18*clamp(h.price)}
function staticScore(c,mode="balanced"){const base=staticBaseScore(c),price=clamp(c?.hints?.price),free=c?.free?1:0,quality=clamp(c?.hints?.quality);return mode==="free"?.68*base+.22*free+.10*price:mode==="quality"?.80*base+.20*quality:base}
function rankStatic(rows,mode="balanced",filter=()=>true){return rows.filter(filter).slice().sort((a,b)=>staticScore(b,mode)-staticScore(a,mode))}
function runtimeReselectLanes(baseLanes,rows){const prior=new Map(baseLanes.map((l,i)=>[l.company,{lane:l,rank:i}])),by=new Map();for(const c of rows){if(!by.has(c.company))by.set(c.company,[]);by.get(c.company).push(c)}const companies=[...by.entries()].map(([company,candidates])=>{const providerCount=new Set(candidates.map(x=>norm(x.provider))).size,baseRank=prior.get(company)?.rank??Number.MAX_SAFE_INTEGER,best=Math.max(...candidates.map(x=>staticScore(x,"balanced")))+Math.min(.06,Math.max(0,providerCount-1)*.025);return{company,candidates,providerCount,baseRank,best}}).sort((a,b)=>Number(b.providerCount>=2)-Number(a.providerCount>=2)||b.providerCount-a.providerCount||a.baseRank-b.baseRank||b.best-a.best).slice(0,MAX_LANES);if(companies.length<2)throw new Error("EXPERT_ROUTE_INSUFFICIENT_EXECUTABLE_COMPANIES_AFTER_RUNTIME_QUARANTINE");return companies.map((x,i)=>{const p=prior.get(x.company)?.lane,allowed=new Set(x.candidates.map(providerKey)),keep=list=>Array.isArray(list)?list.filter(c=>allowed.has(providerKey(c))):[];let quality=p?keep(p.quality):[],balanced=p?keep(p.balanced):[],free=p?keep(p.free):[];if(!quality.length)quality=rankStatic(x.candidates,"quality");if(!balanced.length)balanced=rankStatic(x.candidates,"balanced");if(!free.length)free=rankStatic(x.candidates,"free",c=>c.free);return{lane:String(i+1),company:x.company,candidates:x.candidates,provider_count:x.providerCount,quality,balanced,free}})}

export async function buildExpertRoutePlan(env={},fetchImpl=fetch){
  const base=await buildBaseExpertRoutePlan(env,fetchImpl),t=await runtimeTelemetry(env,fetchImpl),q=t.quarantine,pq=t.providerQuarantine;
  const routeCandidates=base.routeCandidates.filter(c=>!q.has(providerKey(c))&&!pq.has(norm(c.provider)));
  const runtimeQuarantineApplied=q.size>0||pq.size>0;
  const lanes=runtimeQuarantineApplied?runtimeReselectLanes(base.lanes,routeCandidates):base.lanes;
  const routes=routeShards(lanes.length).map(s=>buildRouteShard(s,lanes)).filter(Boolean),routingFingerprint=await digest(routes.map(r=>({routeName:r.routeName,elements:r.elements})));
  const summary={...base.summary,
    schema:"expert-route-plan-v17-quarantine-half-open",
    provider_execution_policy:"ai-gateway-provider-config-plus-live-health-plus-metadata-log-model-and-provider-failure-quarantine",
    model_runtime_quarantine:true,
    provider_runtime_quarantine:true,
    provider_fault_domain_isolation:true,
    provider_fault_requires_low_success_rate:true,
    runtime_quarantine_half_open:true,
    runtime_quarantine_window_ms:RUNTIME_QUARANTINE_WINDOW_MS,
    runtime_expired_expert_samples:Number(t.expiredExpertSamples||0),
    chat_completion_compat_quarantine:"privacy-safe-failure-evidence",
    runtime_lane_reselection:true,
    runtime_reselection_applied:runtimeQuarantineApplied,
    runtime_quarantine_count:q.size,
    runtime_provider_quarantine_count:pq.size,
    runtime_provider_quarantines:t.providerQuarantineDetails,
    runtime_quarantine_samples:t.expertSamples,
    runtime_gateway_log_samples:t.samples,
    runtime_fallback_step_count:t.fallbackSteps,
    runtime_fallback_success_count:t.fallbackSuccesses,
    runtime_fallback_observed:t.fallbackSteps>0,
    runtime_quarantine_reason:t.readable?(pq.size?"RECENT_EXPERT_PROVIDER_FAULT_DOMAIN":q.size?"RECENT_EXPERT_MODEL_FAILURE":"NO_RECENT_EXPERT_MODEL_OR_PROVIDER_FAILURE"):"TELEMETRY_UNAVAILABLE",
    runtime_quarantine_policy:"only Expert telemetry inside the last 30 minutes can quarantine; stale failures expire into half-open eligibility. model: terminal-client>=1 OR timeout>=2 OR expert-failures>=2-and-success-rate<0.34; provider: >=2 distinct models AND success-rate<0.34 AND (timeouts>=2 OR terminal>=3 OR failures>=3)",
    telemetry_payload_read:false,
    effective_model_timeout_ms:GATEWAY_MODEL_TIMEOUT_MS,
    fallback_budget_policy:"quality<=60s-balanced<=90s-free-first<=120s-before-overhead",
    candidate_count:routeCandidates.length,
    company_count:new Set(routeCandidates.map(x=>x.company)).size,
    provider_count:new Set(routeCandidates.map(x=>norm(x.provider))).size,
    providers:[...new Set(routeCandidates.map(x=>norm(x.provider)))],
    lanes:lanes.map(l=>({lane:l.lane,company:l.company,candidate_count:l.candidates.length,provider_count:l.provider_count,providers:[...new Set(l.candidates.map(x=>x.provider))]})),
    routes:routes.map(r=>({route_name:r.routeName,lane_min:r.lane_min,lane_max:r.lane_max,lanes:r.lanes,element_count:r.element_count,model_count:r.model_count,conditional_count:r.conditional_count}))
  };
  return{...base,routeCandidates,lanes,routes,summary,routing_fingerprint:routingFingerprint,plan_digest:await digest({...summary,routing_fingerprint:routingFingerprint})};
}

export async function refreshExpertRoutes(env={},fetchImpl=fetch,preparedPlan=null){
  const plan=preparedPlan||await buildExpertRoutePlan(env,fetchImpl),receipt=await refreshBaseExpertRoutes(env,fetchImpl,plan);
  return{...receipt,
    schema:"expert-route-refresh-v17-quarantine-half-open",
    provider_execution_policy:plan.summary?.provider_execution_policy||receipt.provider_execution_policy,
    model_runtime_quarantine:true,
    provider_runtime_quarantine:true,
    provider_fault_domain_isolation:true,
    provider_fault_requires_low_success_rate:true,
    runtime_quarantine_half_open:true,
    runtime_quarantine_window_ms:RUNTIME_QUARANTINE_WINDOW_MS,
    runtime_expired_expert_samples:Number(plan.summary?.runtime_expired_expert_samples||0),
    chat_completion_compat_quarantine:"privacy-safe-failure-evidence",
    runtime_lane_reselection:true,
    runtime_reselection_applied:plan.summary?.runtime_reselection_applied===true,
    runtime_quarantine_count:Number(plan.summary?.runtime_quarantine_count||0),
    runtime_provider_quarantine_count:Number(plan.summary?.runtime_provider_quarantine_count||0),
    runtime_provider_quarantines:plan.summary?.runtime_provider_quarantines||[],
    runtime_quarantine_samples:Number(plan.summary?.runtime_quarantine_samples||0),
    runtime_fallback_step_count:Number(plan.summary?.runtime_fallback_step_count||0),
    runtime_fallback_success_count:Number(plan.summary?.runtime_fallback_success_count||0),
    runtime_fallback_observed:plan.summary?.runtime_fallback_observed===true,
    telemetry_payload_read:false,
    effective_model_timeout_ms:GATEWAY_MODEL_TIMEOUT_MS,
    fallback_budget_policy:plan.summary?.fallback_budget_policy||null
  };
}
