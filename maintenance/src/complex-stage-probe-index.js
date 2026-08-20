import {buildModelUniverse} from "./model-universe.js";
import {refreshExpertRoutes} from "./expert-route-manager.js";

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const safe=v=>String(v??"UNKNOWN").replace(/[^0-9A-Za-z_.:/-]/g,"_").slice(0,180);
const hex64=v=>/^[a-f0-9]{64}$/i.test(String(v||""));
const routeShard=lane=>{const n=Math.trunc(Number(lane));return !Number.isFinite(n)||n<1||n>8?null:n<=2?"lanes-1-2":n<=4?"lanes-3-4":n<=6?"lanes-5-6":"lanes-7-8"};
function auth(request,env){const a=String(env.MAINTENANCE_RUNTIME_E2E_PROBE||""),b=String(request.headers.get("x-maintenance-e2e-probe")||"");if(!a||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
async function call(binding,url,{method="GET",body,timeout=120000}={}){if(!binding?.fetch)return{ok:false,http_status:0,error:"UNBOUND",body:null};const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await binding.fetch(new Request(url,{method,headers:{accept:"application/json",...(body===undefined?{}:{"content-type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:c.signal}));const x=await r.json().catch(()=>null);return{ok:r.ok&&x?.ok!==false,http_status:r.status,error:r.ok?null:String(x?.error||x?.error_code||`HTTP_${r.status}`),body:x}}catch(e){return{ok:false,http_status:0,error:e?.name==="AbortError"?"TIMEOUT":safe(e?.message||e),body:null}}finally{clearTimeout(t)}}

async function sources(env){
  try{
    const u=await buildModelUniverse(env),s=u.source_status||{};
    const names=["openrouter","huggingface","workers-ai","deepseek"];
    const status=Object.fromEntries(names.map(name=>[name,{ok:s?.[name]?.ok===true,count:Number(s?.[name]?.count||0),transport:String(s?.[name]?.transport||""),verified_count:Number(s?.[name]?.verified_count||0),inferred_count:Number(s?.[name]?.inferred_count||0)}]));
    const ok=names.every(name=>status[name].ok&&status[name].count>0)&&Number(u.candidate_count)>0&&Number(u.company_count)>=3;
    return{ok,error:ok?null:"SOURCE_POOL_NOT_ALL_GREEN",candidate_count:Number(u.candidate_count||0),company_count:Number(u.company_count||0),companies:Array.isArray(u.companies)?u.companies.slice(0,16):[],source_status:status,schema:String(u.schema||"")};
  }catch(e){return{ok:false,error:safe(e?.message||e),candidate_count:0,company_count:0,source_status:{}}}
}

async function routes(env){
  try{
    const r=await refreshExpertRoutes(env),family=Array.isArray(r.route_family)?r.route_family:[],lanes=Array.isArray(r.lanes)?r.lanes:[];
    const shardNames=new Set(family.map(x=>String(x?.route_name||"")));
    const expected=["expert-panel-lanes-1-2-v1","expert-panel-lanes-3-4-v1","expert-panel-lanes-5-6-v1","expert-panel-lanes-7-8-v1"];
    const complete=family.every(x=>String(x?.route_id||"")&&String(x?.version_id||"")&&Array.isArray(x?.lanes)&&x.lanes.length>=1&&Number(x?.element_count)>0&&Number(x?.model_count)>0);
    const ok=r?.ok===true&&r?.status==="active"&&r?.schema==="expert-route-refresh-v6-lane-pair-shards"&&hex64(r?.plan_digest)&&lanes.length>=8&&family.length===4&&expected.every(x=>shardNames.has(x))&&complete;
    return{ok,error:ok?null:"DYNAMIC_ROUTE_REFRESH_INCOMPLETE",status:String(r?.status||""),schema:String(r?.schema||""),plan_digest:String(r?.plan_digest||""),candidate_count:Number(r?.candidate_count||0),company_count:Number(r?.company_count||0),lane_count:lanes.length,route_count:family.length,routes:family.map(x=>({route_name:String(x?.route_name||""),lane_min:Number(x?.lane_min||0),lane_max:Number(x?.lane_max||0),lanes:x?.lanes||[],element_count:Number(x?.element_count||0),model_count:Number(x?.model_count||0),created:x?.created===true})),source_status:r?.source_status||{},dynamic_route_mutation:true};
  }catch(e){return{ok:false,error:safe(e?.message||e),dynamic_route_mutation:true}}
}

async function expert(env){const prompt="Complex quantitative systems probe. Compare competing assumptions for a hypothetical service launch under uncertain demand, stress-test downside scenarios, identify a decision threshold, and provide an adversarial final judgment. Do not use external facts, tools or web.";const r=await call(env.EXPERT_CENTER,"https://expert.internal/v1/run",{method:"POST",body:{task_id:`stage-expert-${crypto.randomUUID()}`,prompt,task_domain:"quantitative",task_type:"analysis",complexity:"high",reasoning_depth:"deep",cost_priority:"economy",model_count:4,rounds:1,max_tokens:192,timeout_seconds:300,cost_mode:"free-first"},timeout:360000}),b=r.body||{},ps=[...(Array.isArray(b.experts)?b.experts:[]),...(Array.isArray(b.judges)?b.judges:[])],receipts=ps.map(p=>({model:String(p?.model||""),provider:String(p?.provider||""),company:String(p?.company||""),lane:Number(p?.meta?.lane||p?.lane||0),route_shard:routeShard(p?.meta?.lane||p?.lane)})),companies=new Set(receipts.map(x=>x.company.toLowerCase()).filter(Boolean)),providers=new Set(receipts.map(x=>x.provider.toLowerCase()).filter(Boolean)),shards=new Set(receipts.map(x=>x.route_shard).filter(Boolean));const complete=receipts.length>=3&&receipts.every(x=>x.model&&x.provider&&x.company&&x.route_shard&&Number.isInteger(x.lane)&&x.lane>=1&&x.lane<=8);const ok=r.http_status===200&&b.ok===true&&b.status==="completed"&&b.company_diverse===true&&complete&&companies.size>=3&&providers.size>=1&&shards.size>=2&&b.route_family==="expert-panel"&&b.route_registry_schema==="expert-route-registry-v4.2-lane-pair"&&hex64(b.output_digest);return{ok,http_status:r.http_status,error:ok?null:safe(r.error||b.error||"EXPERT_FAILED"),participant_count:receipts.length,company_count:companies.size,provider_count:providers.size,providers:[...providers],route_shard_count:shards.size,route_shards:[...shards],receipts,route_family:String(b.route_family||""),route_registry_schema:String(b.route_registry_schema||""),output_digest:String(b.output_digest||""),planner_source:String(b?.panel_plan?.planner_source||"")}}

export default{async fetch(request,env){if(!auth(request,env))return json({ok:false,error:"NOT_FOUND"},404);const mode=String(env.COMPLEX_STAGE_MODE||"sources");let result;if(mode==="sources")result=await sources(env);else if(mode==="routes")result=await routes(env);else if(mode==="expert")result=await expert(env);else return json({ok:false,error:"INVALID_MODE"},400);return json({ok:result.ok,mode,result,secrets_redacted:true},result.ok?200:502)}};

export class MaintenanceState{constructor(state){this.state=state}async fetch(){return json({ok:true,diagnostic_only:true})}}
