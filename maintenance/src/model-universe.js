const OR_URL="https://openrouter.ai/api/v1/models";
const HF_URL="https://huggingface.co/api/models";
const DEEPSEEK_URL="https://api.deepseek.com/models";
const CF_API="https://api.cloudflare.com/client/v4";
const CF_GATEWAY="https://gateway.ai.cloudflare.com/v1";
const MAX_HF_PAGES=8;
const HF_PAGE_SIZE=100;
const BANNED_COMPANIES=new Set(["openai","anthropic","claude","aion-labs"]);

function clean(v){return String(v??"").trim()}
function norm(v){return clean(v).toLowerCase().replace(/[_\s]+/g,"-")}
function clamp(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0.5}
function logScore(v,scale=100000){const n=Math.max(0,Number(v)||0);return clamp(Math.log10(1+n)/Math.log10(1+scale))}
function safeJson(text){try{return JSON.parse(text)}catch{return null}}
function safeCode(v){return clean(v).replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,120)||"UNKNOWN"}
function companyAlias(v){
  let x=norm(v).replace(/^@cf\//,"");
  if(x.includes("/"))x=x.split("/")[0];
  const aliases={"deepseek-ai":"deepseek","deepseek":"deepseek","qwen":"qwen","zai-org":"zai","z-ai":"zai","google":"google","google-deepmind":"google","meta-llama":"meta","meta":"meta","mistralai":"mistral","mistral":"mistral","nvidia":"nvidia","moonshotai":"moonshot","moonshot":"moonshot","minimaxai":"minimax","minimax":"minimax"};
  return aliases[x]||x.replace(/-(?:ai|org|research)$/," ").trim().replace(/\s+/g,"-");
}
function companyAllowed(company){const c=companyAlias(company);return Boolean(c)&&![...BANNED_COMPANIES].some(x=>c===x||c.includes(x))}
function textOutput(modalities){return !Array.isArray(modalities)||modalities.length===0||modalities.includes("text")}
function isSynthetic(id,name=""){const s=`${id} ${name}`.toLowerCase();return /\b(auto[- ]?router|multi[- ]model|ensemble|fusion)\b/.test(s)||norm(id)==="openrouter/free"}
function freePricing(pricing={}){const vals=[pricing.prompt,pricing.completion,pricing.request].map(v=>Number(v));return vals.every(v=>!Number.isFinite(v)||v===0)}
function dedupe(rows){const seen=new Map();for(const row of rows){const key=`${row.provider}::${row.model}`.toLowerCase();if(!seen.has(key))seen.set(key,row);else{const prev=seen.get(key);seen.set(key,{...prev,...row,capabilities:[...new Set([...(prev.capabilities||[]),...(row.capabilities||[])])],hints:{...(prev.hints||{}),...(row.hints||{})}})}}return[...seen.values()]}
function candidate({provider,model,company,source,free=false,capabilities=[],hints={},verified=true,meta={}}){return{provider:clean(provider),model:clean(model),company:companyAlias(company),source:clean(source),free:Boolean(free),capabilities:[...new Set(capabilities.map(norm).filter(Boolean))],verified:Boolean(verified),hints:{quality:clamp(hints.quality),latency:clamp(hints.latency),throughput:clamp(hints.throughput),context:clamp(hints.context),price:clamp(hints.price),popularity:clamp(hints.popularity)},meta}}

async function requestJson(fetchImpl,url,{headers={},timeoutMs=12000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{const response=await fetchImpl(url,{headers:{accept:"application/json",...headers},signal:controller.signal});const text=await response.text(),payload=safeJson(text);if(!response.ok)throw new Error(`HTTP_${response.status}`);if(payload===null)throw new Error("BAD_JSON");return{payload,response}}finally{clearTimeout(timer)}
}

function openRouterRows(payload,transport){
  const data=Array.isArray(payload?.data)?payload.data:[];const rows=[];
  for(const m of data){const id=clean(m?.id),company=companyAlias(id);if(!id||!companyAllowed(company)||isSynthetic(id,m?.name)||!textOutput(m?.architecture?.output_modalities))continue;const params=Array.isArray(m?.supported_parameters)?m.supported_parameters.map(norm):[],context=Number(m?.context_length||m?.top_provider?.context_length||0),pricing=m?.pricing||{};rows.push(candidate({provider:"openrouter",model:id,company,source:"openrouter",free:id.toLowerCase().includes(":free")||freePricing(pricing),capabilities:["text",...(params.includes("reasoning")?["reasoning"]:[]),...(params.includes("tools")||params.includes("tool-choice")?["tools"]:[])],hints:{quality:params.includes("reasoning")?0.72:0.58,context:context?Math.min(1,Math.log2(Math.max(2048,context))/20):0.5,price:freePricing(pricing)?1:0.55,popularity:0.5,latency:0.5,throughput:0.5},verified:true,meta:{context_length:context||null,created:m?.created||null,catalog_transport:transport}}))}
  return rows;
}
async function openRouterViaGateway(env,fetchImpl){
  const accountId=clean(env?.CF_ACCOUNT_ID||env?.CLOUDFLARE_ACCOUNT_ID),gatewayId=clean(env?.AI_GATEWAY_ID||"test"),token=clean(env?.AI_GATEWAY_TOKEN||env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN);
  if(!accountId||!gatewayId||!token)throw new Error("OPENROUTER_GATEWAY_DISCOVERY_CREDENTIAL_MISSING");
  const root=`${CF_GATEWAY}/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/openrouter`,headers={"cf-aig-authorization":`Bearer ${token}`,"cf-aig-collect-log-payload":"false"};let last="NOT_ATTEMPTED";
  for(const suffix of ["models","v1/models"]){try{const{payload}=await requestJson(fetchImpl,`${root}/${suffix}`,{headers,timeoutMs:15000});const rows=openRouterRows(payload,"cloudflare-ai-gateway-byok");if(rows.length)return rows;last="EMPTY"}catch(error){last=safeCode(error?.message||error)}}
  throw new Error(`OPENROUTER_GATEWAY_MODEL_UNIVERSE_${last}`);
}
export async function discoverOpenRouter(envOrFetch={},fetchMaybe=fetch){
  const legacy=typeof envOrFetch==="function",env=legacy?{}:(envOrFetch||{}),fetchImpl=legacy?envOrFetch:fetchMaybe;let directError=null;
  try{const{payload}=await requestJson(fetchImpl,OR_URL,{headers:{"user-agent":"three-center-model-universe/1.0"},timeoutMs:15000});const rows=openRouterRows(payload,"openrouter-direct");if(rows.length)return rows;directError=new Error("OPENROUTER_DIRECT_MODEL_UNIVERSE_EMPTY")}catch(error){directError=error}
  if(!legacy){try{return await openRouterViaGateway(env,fetchImpl)}catch(error){throw new Error(`OPENROUTER_MODEL_UNIVERSE_UNAVAILABLE_DIRECT_${safeCode(directError?.message)}_GATEWAY_${safeCode(error?.message)}`)}}
  throw new Error(`OPENROUTER_MODEL_UNIVERSE_UNAVAILABLE_DIRECT_${safeCode(directError?.message)}`);
}

function nextLink(header){if(!header)return null;for(const part of String(header).split(",")){const m=part.match(/<([^>]+)>;\s*rel="next"/i);if(m)return m[1]}return null}
export async function discoverHuggingFace(fetchImpl=fetch){
  const rows=[];let url=`${HF_URL}?inference_provider=all&limit=${HF_PAGE_SIZE}&expand=inferenceProviderMapping`;
  for(let page=0;page<MAX_HF_PAGES&&url;page++){
    const{payload,response}=await requestJson(fetchImpl,url,{timeoutMs:15000});const data=Array.isArray(payload)?payload:[];
    for(const m of data){const id=clean(m?.id||m?.modelId),company=companyAlias(id),task=norm(m?.pipeline_tag||m?.pipelineTag||"");if(!id||!companyAllowed(company))continue;const mapping=m?.inferenceProviderMapping||m?.inference_provider_mapping||{};const live=Object.values(mapping||{}).filter(x=>norm(x?.status)==="live"),tasks=new Set([task,...live.map(x=>norm(x?.task))].filter(Boolean));if(tasks.size&&![...tasks].some(x=>["conversational","text-generation","text2text-generation","image-text-to-text"].includes(x)))continue;rows.push(candidate({provider:"huggingface",model:id,company,source:"huggingface",free:false,capabilities:["text",...([...tasks].includes("image-text-to-text")?["vision"]:[])],hints:{quality:0.56+0.18*logScore(m?.likes,10000),context:0.5,price:0.5,popularity:0.55*logScore(m?.downloads,10000000)+0.45*logScore(m?.likes,10000),latency:0.5,throughput:0.5},verified:live.length>0||norm(m?.inference)==="warm",meta:{pipeline_tag:task||null,live_provider_count:live.length,downloads:Number(m?.downloads)||0,likes:Number(m?.likes)||0}}))}
    url=nextLink(response.headers.get("link"));
  }
  if(!rows.length)throw new Error("HUGGINGFACE_MODEL_UNIVERSE_EMPTY");return dedupe(rows);
}

async function workersAIChatCanary(env,fetchImpl,row){
  const accountId=clean(env?.CF_ACCOUNT_ID||env?.CLOUDFLARE_ACCOUNT_ID),gatewayId=clean(env?.AI_GATEWAY_ID||"test"),token=clean(env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN||env?.CF_API_TOKEN);if(!accountId||!token)return false;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetchImpl(`${CF_API}/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`,{method:"POST",headers:{authorization:`Bearer ${token}`,accept:"application/json","content-type":"application/json","cf-aig-gateway-id":gatewayId,"cf-aig-collect-log-payload":"false"},body:JSON.stringify({model:row.model,messages:[{role:"user",content:"Return OK."}],temperature:0,stream:false,max_tokens:1}),signal:controller.signal});await response.text().catch(()=>"");return response.ok} catch{return false} finally{clearTimeout(timer)}
}
async function retainWorkersAIChatReady(env,fetchImpl,rows){
  const groups=new Map();for(const row of rows){if(!groups.has(row.company))groups.set(row.company,[]);groups.get(row.company).push(row)}
  const verified=await Promise.all([...groups.values()].map(async group=>{const ranked=group.slice().sort((a,b)=>(b?.hints?.context||0)-(a?.hints?.context||0));for(const row of ranked.slice(0,3)){if(await workersAIChatCanary(env,fetchImpl,row))return{...row,verified:true,meta:{...(row.meta||{}),runtime_canary:"workers-ai-chat-completions",runtime_canary_ok:true}}}return null}));
  return verified.filter(Boolean);
}
export async function discoverWorkersAI(env,fetchImpl=fetch){
  const accountId=clean(env?.CF_ACCOUNT_ID||env?.CLOUDFLARE_ACCOUNT_ID),token=clean(env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN||env?.CF_API_TOKEN);if(!accountId||!token)throw new Error("WORKERS_AI_DISCOVERY_CREDENTIAL_MISSING");
  const url=`${CF_API}/accounts/${encodeURIComponent(accountId)}/ai/models/search?task=text-generation&per_page=1000`;
  const{payload}=await requestJson(fetchImpl,url,{headers:{authorization:`Bearer ${token}`}});const result=payload?.result??payload?.data??payload,models=Array.isArray(result)?result:Array.isArray(result?.models)?result.models:[];const rows=[];
  for(const m of models){const id=clean(m?.name||m?.id||m?.model);if(!id)continue;const company=companyAlias(id),task=norm(m?.task?.name||m?.task||m?.pipeline_tag||"");if(!companyAllowed(company))continue;if(task&&!task.includes("text-generation"))continue;const props=m?.properties||m?.metadata||{};rows.push(candidate({provider:"workers-ai",model:id,company,source:"workers-ai",free:false,capabilities:["text"],hints:{quality:0.58,context:props?.context_window?Math.min(1,Math.log2(Math.max(2048,Number(props.context_window)))/20):0.5,price:0.6,popularity:0.5,latency:0.6,throughput:0.6},verified:false,meta:{task:task||null,chat_route_eligible:true}}))}
  if(!rows.length)throw new Error("WORKERS_AI_MODEL_UNIVERSE_EMPTY");const ready=await retainWorkersAIChatReady(env,fetchImpl,dedupe(rows));if(!ready.length)throw new Error("WORKERS_AI_CHAT_CANARY_EMPTY");return ready;
}

export async function discoverDeepSeek(env,openRouterRows=[],fetchImpl=fetch){
  const token=clean(env?.DEEPSEEK_API_KEY);const rows=[];
  if(token){const{payload}=await requestJson(fetchImpl,DEEPSEEK_URL,{headers:{authorization:`Bearer ${token}`}});for(const m of Array.isArray(payload?.data)?payload.data:[]){const id=clean(m?.id),company=companyAlias(m?.owned_by||"deepseek");if(!id||!companyAllowed(company))continue;rows.push(candidate({provider:"deepseek",model:id,company,source:"deepseek",free:false,capabilities:["text","reasoning"],hints:{quality:0.68,context:0.7,price:0.7,popularity:0.7,latency:0.55,throughput:0.55},verified:true,meta:{discovery:"official-models-api"}}))}}
  if(!rows.length){for(const or of openRouterRows){if(companyAlias(or.company)!=="deepseek")continue;const id=clean(or.model).replace(/^deepseek\//i,"");if(!id)continue;rows.push(candidate({provider:"deepseek",model:id,company:"deepseek",source:"deepseek",free:false,capabilities:or.capabilities||["text"],hints:{...(or.hints||{}),quality:Math.max(0.45,(or.hints?.quality||0.5)-0.08)},verified:false,meta:{discovery:"openrouter-owner-inference",direct_model_unverified:true}}))}}
  return dedupe(rows);
}

export async function buildModelUniverse(env={},fetchImpl=fetch){
  const source_status={};let openrouter=[],huggingface=[],workersAI=[],deepseek=[];
  try{openrouter=await discoverOpenRouter(env,fetchImpl);source_status.openrouter={ok:true,count:openrouter.length,transport:clean(openrouter[0]?.meta?.catalog_transport)||"unknown"}}catch(error){source_status.openrouter={ok:false,count:0,error:String(error?.message||error).slice(0,240)}}
  try{huggingface=await discoverHuggingFace(fetchImpl);source_status.huggingface={ok:true,count:huggingface.length}}catch(error){source_status.huggingface={ok:false,count:0,error:String(error?.message||error).slice(0,120)}}
  try{workersAI=await discoverWorkersAI(env,fetchImpl);source_status["workers-ai"]={ok:true,count:workersAI.length,runtime_verified:true}}catch(error){source_status["workers-ai"]={ok:false,count:0,error:String(error?.message||error).slice(0,120)}}
  try{deepseek=await discoverDeepSeek(env,openrouter,fetchImpl);source_status.deepseek={ok:deepseek.length>0,count:deepseek.length,verified_count:deepseek.filter(x=>x.verified).length,inferred_count:deepseek.filter(x=>!x.verified).length}}catch(error){source_status.deepseek={ok:false,count:0,error:String(error?.message||error).slice(0,120)}}
  const candidates=dedupe([...openrouter,...huggingface,...workersAI,...deepseek]).filter(x=>x.model&&x.provider&&companyAllowed(x.company));
  const companies=[...new Set(candidates.map(x=>x.company))];
  return{schema:"expert-model-universe-v1",generated_at:new Date().toISOString(),model_id_pinning:false,future_models_auto_discover:true,source_status,candidate_count:candidates.length,company_count:companies.length,companies,candidates};
}
