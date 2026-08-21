import {collectCapabilityManifests} from "./evolution-kernel.js";
import {probeLangGraphSupervisor,runLangGraphSupervisor} from "./langgraph-supervisor.js";

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const safe=v=>String(v??"").replace(/[^0-9A-Za-z_.:/@+-]/g,"_").slice(0,180);
function auth(request,env){const a=String(env.LA_BRAIN_RUNTIME_PROBE||""),b=String(request.headers.get("x-la-brain-probe")||"");if(!a||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
function pickCapability(manifest){const rows=Array.isArray(manifest?.capabilities)?manifest.capabilities:[];return rows.find(x=>x?.health?.status==="ready"&&x?.write_scope==="none")||rows.find(x=>x?.health?.status==="ready")||rows[0]||null}
function bindingFor(env,center){return center==="intelligence"?env.INTELLIGENCE_CENTER:center==="compute"?env.COMPUTE_CENTER:center==="expert"?env.EXPERT_CENTER:null}
async function dispatchCapabilityProbe(env,center){const binding=bindingFor(env,center);if(!binding?.fetch)return{center,ok:false,error:"CENTER_BINDING_UNAVAILABLE"};try{const response=await binding.fetch(new Request(`https://${center}.internal/v1/capabilities`,{method:"GET",headers:{accept:"application/json"}}));const body=await response.json().catch(()=>null);const manifest=body?.capability_manifest||body?.manifest||null;return{center,ok:response.status===200&&Boolean(manifest)&&String(manifest?.center||"")===center,http_status:response.status,manifest_center:safe(manifest?.center||""),capability_count:Array.isArray(manifest?.capabilities)?manifest.capabilities.length:0}}catch(error){return{center,ok:false,error:safe(error?.message||error)}}}

export default{async fetch(request,env){
  if(!auth(request,env))return json({ok:false,error:"NOT_FOUND"},404);
  try{
    const collected=await collectCapabilityManifests(env);
    const byCenter=new Map((collected.manifests||[]).map(x=>[String(x?.center||""),x]));
    const targets=["intelligence","compute","expert"],selected=[];
    for(const center of targets){const capability=pickCapability(byCenter.get(center));if(capability)selected.push({center,id:String(capability.id),write_scope:String(capability.write_scope||""),network_scope:String(capability.network_scope||"")})}
    if(collected.ok!==true||selected.length!==3)return json({ok:false,stage:"discover",manifest_status:collected.status,manifest_error_count:(collected.errors||[]).length,selected_center_count:selected.length,secrets_redacted:true},502);
    const health=await probeLangGraphSupervisor(env);
    if(health.ok!==true)return json({ok:false,stage:"langgraph-health",langgraph_health:health,secrets_redacted:true},502);
    const task={task_id:`la-brain-${crypto.randomUUID()}`,goal:"Prove the LA/LangGraph supervisor can autonomously discover, plan, validate and dispatch a bounded read-only control cycle across intelligence, compute and expert centers.",constraints:{allowed_centers:targets,write_scope:"none"},risk:{max_trust_level:"T4",uncertainty:"high"},budget:{currency:"USD",max_cost:0},required_capabilities:selected.map(x=>x.id),deadline:new Date(Date.now()+10*60*1000).toISOString(),success_criteria:["all three centers discovered","LangGraph validates the cross-center graph","all three service-binding dispatch probes return valid capability manifests"]};
    const supervisor=await runLangGraphSupervisor(task,env);
    const nodes=Array.isArray(supervisor?.plan?.graph?.nodes)?supervisor.plan.graph.nodes:[];
    const plannedCenters=[...new Set(nodes.map(x=>String(x?.center||"")).filter(Boolean))];
    const planCoversAll=targets.every(x=>plannedCenters.includes(x));
    if(supervisor.ok!==true||supervisor.status!=="ready"||!planCoversAll)return json({ok:false,stage:"plan-validate",manifest_status:collected.status,selected,langgraph_status:supervisor?.status||null,planned_centers:plannedCenters,plan_covers_all:planCoversAll,trace:supervisor?.trace||[],secrets_redacted:true},502);
    const dispatch=[];for(const center of targets)dispatch.push(await dispatchCapabilityProbe(env,center));
    const dispatchOk=dispatch.every(x=>x.ok===true);
    const ok=dispatchOk;
    return json({ok,stage:"complete",runtime:"@langchain/langgraph@1.4.10",runtime_host:"expert-worker",manifest_status:collected.status,center_manifest_count:(collected.manifests||[]).length,selected,langgraph_status:supervisor.status,planned_centers:plannedCenters,plan_covers_all:planCoversAll,dispatch,autonomous_shadow_run:true,human_intervention_required:false,control_scope:"read-only-service-binding",production_mutation:false,production_autonomous_execution_enabled:false,execution_trace:["discover","self-model","plan","langgraph-validate","dispatch:intelligence","dispatch:compute","dispatch:expert","verify"],secrets_redacted:true},ok?200:502);
  }catch(error){return json({ok:false,stage:"exception",error:safe(error?.message||error),autonomous_shadow_run:false,production_mutation:false,secrets_redacted:true},502)}
}};
