const EXCLUDED_COMPANIES=new Set(["openai","anthropic"]);
const DEFAULT_SEATS=["expert-1","expert-2","expert-3","judge"];

function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function idOf(model){return String(model?.id||"").trim()}
function companyOf(model){const id=idOf(model).toLowerCase();return id.includes("/")?id.split("/")[0]:""}
function paid(model){const p=model?.pricing||{};return num(p.prompt)>0||num(p.completion)>0||num(p.request)>0}
function reasoning(model){return Array.isArray(model?.supported_parameters)&&model.supported_parameters.includes("reasoning")}
function textOutput(model){const out=model?.architecture?.output_modalities;return !Array.isArray(out)||out.length===0||out.includes("text")}
function unexpired(model,now){const exp=model?.expiration_date;if(!exp)return true;const t=Date.parse(exp);return !Number.isFinite(t)||t>Date.parse(now)}

export function eligibleExpertCandidate(model,{now=new Date().toISOString()}={}){
  const id=idOf(model),low=id.toLowerCase(),company=companyOf(model);
  if(!id||!company)return false;
  if(EXCLUDED_COMPANIES.has(company))return false;
  if(low.includes("anthropic")||low.includes("claude")||low.includes("openai"))return false;
  if(low.includes(":free")||low.includes("flash"))return false;
  if(!paid(model)||!reasoning(model)||!textOutput(model)||!unexpired(model,now))return false;
  return true;
}

export function selectExpertCandidatePool(models,{seatNames=DEFAULT_SEATS,maxSameCompanyModels=3,now=new Date().toISOString()}={}){
  const eligible=(Array.isArray(models)?models:[]).filter(m=>eligibleExpertCandidate(m,{now}));
  const byCompany=new Map();
  for(const model of eligible){
    const company=companyOf(model);
    const list=byCompany.get(company)||[];
    if(list.length<Math.max(1,maxSameCompanyModels))list.push(model);
    byCompany.set(company,list);
  }
  const companies=[];
  for(const model of eligible){
    const company=companyOf(model);
    if(!companies.includes(company))companies.push(company);
    if(companies.length>=seatNames.length)break;
  }
  const lanes=seatNames.map((seat,i)=>{
    const company=companies[i]||null,ranked=company?(byCompany.get(company)||[]):[];
    return {seat,company,primary:ranked[0]?.id||null,fallbacks:ranked.slice(1).map(x=>x.id)};
  });
  return {
    source:"openrouter-models-api",
    ordering:"intelligence-high-to-low-input-order",
    policy:{reasoning:true,paid:true,exclude_free:true,exclude_flash:true,exclude_openai:true,exclude_anthropic_claude:true,company_dedup:true},
    eligible_count:eligible.length,
    distinct_company_count:byCompany.size,
    ready:lanes.every(x=>x.primary)&&new Set(lanes.map(x=>x.company)).size===seatNames.length,
    lanes
  };
}

export const EXPERT_CANDIDATE_QUERY={
  endpoint:"https://openrouter.ai/api/v1/models",
  params:{supported_parameters:"reasoning",output_modalities:"text",sort:"intelligence-high-to-low"}
};
