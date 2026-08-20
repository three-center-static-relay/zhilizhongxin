const CF_API="https://api.cloudflare.com/client/v4";
const DEFAULT_GATEWAY_ID="test";
const MAX_ELEMENTS=64;
const MAX_BODY_BYTES=220000;
const ROUTE_NAME=/^expert-panel(?:-(?:plan|general|code|regulated|research|strategy|creative))?-v1$/;
const ID=/^[0-9A-Za-z_-]{1,128}$/;
const TENCENT_TOKENHUB_PROVIDER=Object.freeze({
  name:"Tencent TokenHub",
  slug:"tencent-tokenhub",
  base_url:"https://tokenhub.tencentmaas.com",
  description:"Tencent Cloud TokenHub Guangzhou / China mainland OpenAI-compatible provider",
  link:"https://cloud.tencent.com/document/product/1823/130078",
  enable:false
});

function fail(code,status=400,details=null){
  const e=new Error(code);e.status=status;if(details)e.details=details;return e;
}
function cleanId(v,label){
  const x=String(v||"").trim();
  if(!ID.test(x))throw fail(`${label}_INVALID`,400);
  return x;
}
function credentials(env){
  const accountId=String(env?.CF_ACCOUNT_ID||env?.CLOUDFLARE_ACCOUNT_ID||"").trim();
  const token=String(env?.CF_API_TOKEN||env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN||"").trim();
  return{accountId,token};
}
function gatewayId(env,input){
  const configured=String(env.AI_GATEWAY_ID||DEFAULT_GATEWAY_ID).trim();
  const requested=String(input?.gateway_id||configured).trim();
  if(!configured||requested!==configured)throw fail("AI_GATEWAY_CONTROL_GATEWAY_MISMATCH",403);
  return configured;
}
function elementsOf(input){
  const e=input?.elements;
  if(!Array.isArray(e)||e.length<1||e.length>MAX_ELEMENTS)throw fail("AI_GATEWAY_CONTROL_ELEMENTS_INVALID",400);
  const bytes=new TextEncoder().encode(JSON.stringify(e)).length;
  if(bytes>MAX_BODY_BYTES)throw fail("AI_GATEWAY_CONTROL_BODY_TOO_LARGE",413);
  return e;
}
function routeNameOf(input){
  const n=String(input?.name||"").trim();
  if(!ROUTE_NAME.test(n))throw fail("AI_GATEWAY_CONTROL_ROUTE_NAME_DENIED",403);
  return n;
}
export function operationRequest(env,input={}){
  const op=String(input?.operation||"").trim();
  const gateway=gatewayId(env,input);
  let method="GET",path="",body,scope="gateway";
  if(op==="logs.list"){
    const page=Math.max(1,Math.min(4,Math.trunc(Number(input.page)||1)));
    const per=Math.max(1,Math.min(50,Math.trunc(Number(input.per_page)||50)));
    path=`/logs?per_page=${per}&page=${page}&order_by=created_at&order_by_direction=desc`;
  }else if(op==="routes.list"){
    path="/routes?per_page=100";
  }else if(op==="routes.create"){
    method="POST";path="/routes";body={name:routeNameOf(input),elements:elementsOf(input)};
  }else if(op==="versions.list"){
    path=`/routes/${encodeURIComponent(cleanId(input.route_id,"ROUTE_ID"))}/versions?per_page=100`;
  }else if(op==="versions.create"){
    method="POST";path=`/routes/${encodeURIComponent(cleanId(input.route_id,"ROUTE_ID"))}/versions`;body={elements:elementsOf(input)};
  }else if(op==="versions.get"){
    path=`/routes/${encodeURIComponent(cleanId(input.route_id,"ROUTE_ID"))}/versions/${encodeURIComponent(cleanId(input.version_id,"VERSION_ID"))}`;
  }else if(op==="deployments.create"){
    method="POST";path=`/routes/${encodeURIComponent(cleanId(input.route_id,"ROUTE_ID"))}/deployments`;body={version_id:cleanId(input.version_id,"VERSION_ID")};
  }else if(op==="custom-providers.tencent-tokenhub.list"){
    scope="account";path="/custom-providers?search=tencent-tokenhub";
  }else if(op==="custom-providers.tencent-tokenhub.create"){
    scope="account";method="POST";path="/custom-providers";body={...TENCENT_TOKENHUB_PROVIDER};
  }else if(op==="custom-providers.tencent-tokenhub.enable"){
    scope="account";method="PATCH";path=`/custom-providers/${encodeURIComponent(cleanId(input.provider_id,"PROVIDER_ID"))}`;body={enable:true};
  }else if(op==="custom-providers.tencent-tokenhub.disable"){
    scope="account";method="PATCH";path=`/custom-providers/${encodeURIComponent(cleanId(input.provider_id,"PROVIDER_ID"))}`;body={enable:false};
  }else{
    throw fail("AI_GATEWAY_CONTROL_OPERATION_DENIED",403);
  }
  return {gateway,scope,method,path,body};
}
export async function aiGatewayControlRequest(env,input,fetchImpl=fetch){
  const {accountId,token}=credentials(env);
  if(!accountId||!token)throw fail("CF_API_NOT_CONFIGURED",503);
  const req=operationRequest(env,input);
  const headers={authorization:`Bearer ${token}`,accept:"application/json"};
  if(req.body!==undefined)headers["content-type"]="application/json";
  const base=req.scope==="account"
    ?`${CF_API}/accounts/${encodeURIComponent(accountId)}/ai-gateway`
    :`${CF_API}/accounts/${encodeURIComponent(accountId)}/ai-gateway/gateways/${encodeURIComponent(req.gateway)}`;
  const response=await fetchImpl(`${base}${req.path}`,{
    method:req.method,headers,...(req.body===undefined?{}:{body:JSON.stringify(req.body)})
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok||payload?.success===false){
    const code=Array.isArray(payload?.errors)&&payload.errors[0]?.code!=null?String(payload.errors[0].code):"unknown";
    throw fail(`AI_GATEWAY_CONTROL_UPSTREAM_${response.status}_CF_${code}`,502,{http_status:response.status,cloudflare_error_code:code});
  }
  return payload;
}
