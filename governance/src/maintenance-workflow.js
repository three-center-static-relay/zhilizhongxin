import {WorkflowEntrypoint} from "cloudflare:workers";
import {planAutonomicRepair} from "./autonomic-maintenance.js";

const clean=v=>String(v??"").trim();
function modelText(result){const direct=clean(result?.response);if(direct)return direct;const content=result?.choices?.[0]?.message?.content;if(typeof content==="string")return clean(content);return""}
function boundedReceipt(value){const source=value&&typeof value==="object"?value:{};return{ok:source.ok===true,center:clean(source.center).slice(0,80),stage:clean(source.stage).slice(0,80),error_code:clean(source.error_code||source.error).slice(0,160),http_status:Number(source.http_status||source.status_code||0),provider:clean(source.provider).slice(0,120),model:clean(source.model).slice(0,180),failure_count:Math.max(0,Math.min(20,Number(source.failure_count||0))),affected_centers:Math.max(0,Math.min(4,Number(source.affected_centers||0))),code_defect:source.code_defect===true,simple_patch_failed:source.simple_patch_failed===true,max_paid_usd:Math.max(0,Number(source.max_paid_usd||0))}}

export class AutonomicMaintenanceWorkflow extends WorkflowEntrypoint{
  async run(event,step){
    const receipt=await step.do("normalize incident receipt",async()=>boundedReceipt(event?.payload?.receipt));
    const plan=await step.do("classify and plan repair",async()=>planAutonomicRepair(receipt));
    const advisory=await step.do("maintenance brain advisory",{retries:{limit:2,delay:"2 seconds",backoff:"linear"},timeout:"30 seconds"},async()=>{
      if(plan.action==="NOOP")return{ok:true,skipped:true,reason:"healthy"};
      if(!this.env.AI?.run)return{ok:false,skipped:true,reason:"workers-ai-binding-unavailable"};
      const prompt={incident:plan.incident,action:plan.action,constraints:{free_first:true,max_paid_usd:0,tools:false,web:false,production_mutation:false,approved_model_sources:["workers-ai","openrouter","huggingface"]},required_output:{diagnosis:"string",recommended_next_action:"string",confidence:"0..1"}};
      const result=await this.env.AI.run(plan.model.model,{messages:[{role:"system",content:"You are a bounded SRE advisory model. Diagnose only from supplied structured facts. Do not browse, call tools, reveal secrets, change production, or approve your own repair. Return compact JSON only."},{role:"user",content:JSON.stringify(prompt)}],temperature:0,max_completion_tokens:500,stream:false});
      return{ok:true,provider:"workers-ai",model:plan.model.model,text:modelText(result).slice(0,2400),tools_used:false,web_used:false,production_mutation:false};
    });
    const maintenanceProbe=await step.do("probe maintenance executor",{retries:{limit:2,delay:"2 seconds",backoff:"linear"},timeout:"15 seconds"},async()=>{
      if(!this.env.MAINTENANCE_CENTER?.fetch)return{ok:false,bound:false};
      const response=await this.env.MAINTENANCE_CENTER.fetch(new Request("https://maintenance.internal/v1/selftest",{method:"GET",headers:{accept:"application/json"}}));
      return{ok:response.ok,bound:true,http_status:response.status};
    });
    await step.do("emit maintenance telemetry",async()=>{
      if(this.env.EVOLUTION_ANALYTICS?.writeDataPoint)this.env.EVOLUTION_ANALYTICS.writeDataPoint({indexes:[plan.incident.center||"unknown"],blobs:["autonomic-maintenance",plan.incident.error_class,plan.action,plan.model.model],doubles:[maintenanceProbe.ok?1:0]});
      return{written:Boolean(this.env.EVOLUTION_ANALYTICS)};
    });
    return{ok:true,workflow:"autonomic-maintenance-v1",incident:plan.incident,action:plan.action,model:plan.model,reviewer:plan.reviewer,advisory,maintenance_executor:maintenanceProbe,paid_spend_usd:0,production_mutation:false,requires_deterministic_validation:true,approved_model_sources:["workers-ai","openrouter","huggingface"]};
  }
}
