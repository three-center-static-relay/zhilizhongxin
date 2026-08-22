export const EVOLUTION_ANALYTICS_VERSION="cloudflare-analytics-engine-v1-20260822";

const finite=value=>Number.isFinite(Number(value))?Number(value):0;
const text=(value,max=160)=>String(value??"").slice(0,max);

export function emitEvolutionMetric(env,event,fields={}){
  const analytics=env?.EVOLUTION_ANALYTICS;
  if(!analytics?.writeDataPoint)return{ok:false,status:"UNBOUND",provider:"cloudflare-analytics-engine"};
  try{
    analytics.writeDataPoint({
      indexes:[text(event,96)],
      blobs:[
        text(event,96),
        text(fields.status,64),
        text(fields.task_id,160),
        text(fields.candidate_id,160),
        text(fields.path,64),
        text(fields.center,64),
        text(fields.kernel_version,96)
      ],
      doubles:[
        finite(fields.ok===true?1:0),
        finite(fields.capability_count),
        finite(fields.healthy_count),
        finite(fields.gap_count),
        finite(fields.evolution_pressure),
        finite(fields.unhealthy_count),
        finite(fields.staleness),
        finite(fields.fragility),
        finite(fields.complexity_delta),
        finite(fields.risk_delta)
      ]
    });
    return{ok:true,status:"EMITTED",provider:"cloudflare-analytics-engine"};
  }catch(error){
    return{ok:false,status:"EMIT_FAILED",provider:"cloudflare-analytics-engine",error:text(error?.message||error,160)};
  }
}
