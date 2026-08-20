const CF_API="https://api.cloudflare.com/client/v4";
const DEFAULT_GATEWAY_ID="test";
const CANARY_MODEL="@cf/google/gemma-4-26b-a4b-it";

function fail(code,status=500){const e=new Error(code);e.status=status;return e}
function credentials(env){
  const accountId=String(env?.CF_ACCOUNT_ID||"").trim();
  const token=String(env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN||"").trim();
  if(!accountId||!token)throw fail("AI_GATEWAY_WRITE_CANARY_NOT_CONFIGURED",503);
  return{accountId,token};
}
function gatewayId(env){
  const gateway=String(env?.AI_GATEWAY_ID||DEFAULT_GATEWAY_ID).trim();
  if(!/^[0-9A-Za-z_-]{1,128}$/.test(gateway))throw fail("AI_GATEWAY_WRITE_CANARY_GATEWAY_INVALID",500);
  return gateway;
}
function baseUrl(accountId,gateway){return`${CF_API}/accounts/${encodeURIComponent(accountId)}/ai-gateway/gateways/${encodeURIComponent(gateway)}/routes`}
async function requestJson(fetchImpl,url,{method="GET",token,body}={}){
  const response=await fetchImpl(url,{method,headers:{authorization:`Bearer ${token}`,accept:"application/json",...(body===undefined?{}:{"content-type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const payload=await response.json().catch(()=>null);
  return{response,payload};
}
function cloudflareCode(payload){return Array.isArray(payload?.errors)&&payload.errors[0]?.code!=null?String(payload.errors[0].code):"unknown"}
function requireOk(response,payload,label){if(!response.ok||payload?.success===false)throw fail(`${label}_HTTP_${response.status}_CF_${cloudflareCode(payload)}`,response.status||502)}
function resultData(payload){return payload?.result??payload?.data??payload??null}
function canaryElements(){return[
  {id:"start",type:"start",outputs:{next:{elementId:"model"}}},
  {id:"model",type:"model",properties:{provider:"workers-ai",model:CANARY_MODEL,timeout:30000,retries:0},outputs:{success:{elementId:"end"},fallback:{elementId:"end"}}},
  {id:"end",type:"end",outputs:{}}
]}
export async function aiGatewayDynamicRouteWriteCanary(env,fetchImpl=fetch){
  const{accountId,token}=credentials(env),gateway=gatewayId(env),base=baseUrl(accountId,gateway);
  const name=`expert-write-canary-${Date.now()}-${crypto.randomUUID().slice(0,8)}`;
  let routeId="",created=false,verified=false,deleted=false,primaryError=null;
  try{
    const create=await requestJson(fetchImpl,base,{method:"POST",token,body:{name,elements:canaryElements()}});
    requireOk(create.response,create.payload,"AI_GATEWAY_WRITE_CREATE");
    const createdRoute=resultData(create.payload)?.route||resultData(create.payload);
    routeId=String(createdRoute?.id||"").trim();
    if(!routeId)throw fail("AI_GATEWAY_WRITE_CREATE_ID_MISSING",502);
    created=true;
    const get=await requestJson(fetchImpl,`${base}/${encodeURIComponent(routeId)}`,{token});
    requireOk(get.response,get.payload,"AI_GATEWAY_WRITE_VERIFY");
    const readRoute=resultData(get.payload)?.route||resultData(get.payload);
    if(String(readRoute?.id||"").trim()!==routeId)throw fail("AI_GATEWAY_WRITE_VERIFY_ID_MISMATCH",502);
    verified=true;
  }catch(error){primaryError=error}
  if(routeId){
    try{
      const remove=await requestJson(fetchImpl,`${base}/${encodeURIComponent(routeId)}`,{method:"DELETE",token});
      requireOk(remove.response,remove.payload,"AI_GATEWAY_WRITE_DELETE");
      deleted=true;
    }catch(error){
      throw fail(`AI_GATEWAY_WRITE_CANARY_CLEANUP_FAILED:${String(error?.message||error).replace(/[^0-9A-Za-z_.:-]/g,"_").slice(0,120)}`,502);
    }
  }
  if(primaryError)throw primaryError;
  if(!created||!verified||!deleted)throw fail("AI_GATEWAY_WRITE_CANARY_INCOMPLETE",502);
  return{ok:true,permission:"ai_gateway_write",created:true,verified:true,deleted:true,temporary_route_only:true,production_route_changed:false,model_invoked:false,secrets_redacted:true};
}
