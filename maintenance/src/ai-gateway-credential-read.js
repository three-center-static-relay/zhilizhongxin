import {WorkerEntrypoint} from "cloudflare:workers";

const CF_API="https://api.cloudflare.com/client/v4";
const DEFAULT_GATEWAY_ID="test";

function fail(code,status=500){const e=new Error(code);e.status=status;return e}
function credentials(env){
  const accountId=String(env?.CF_ACCOUNT_ID||"").trim();
  const token=String(env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN||"").trim();
  if(!accountId||!token)throw fail("AI_GATEWAY_CREDENTIAL_READ_NOT_CONFIGURED",503);
  return{accountId,token};
}
function gatewayId(env){
  const gateway=String(env?.AI_GATEWAY_ID||DEFAULT_GATEWAY_ID).trim();
  if(!/^[0-9A-Za-z_-]{1,128}$/.test(gateway))throw fail("AI_GATEWAY_CREDENTIAL_GATEWAY_INVALID",500);
  return gateway;
}
export async function aiGatewayCredentialRoutesList(env,fetchImpl=fetch){
  const{accountId,token}=credentials(env),gateway=gatewayId(env);
  const response=await fetchImpl(`${CF_API}/accounts/${encodeURIComponent(accountId)}/ai-gateway/gateways/${encodeURIComponent(gateway)}/routes?per_page=100`,{method:"GET",headers:{authorization:`Bearer ${token}`,accept:"application/json"}});
  const payload=await response.json().catch(()=>null);
  if(!response.ok||payload?.success===false){
    const code=Array.isArray(payload?.errors)&&payload.errors[0]?.code!=null?String(payload.errors[0].code):"unknown";
    throw fail(`AI_GATEWAY_CREDENTIAL_READ_UPSTREAM_${response.status}_CF_${code}`,502);
  }
  return payload;
}
export class AIGatewayCredentialRead extends WorkerEntrypoint{
  async request(input={}){
    if(String(input?.operation||"")!=="routes.list")throw fail("AI_GATEWAY_CREDENTIAL_OPERATION_DENIED",403);
    return aiGatewayCredentialRoutesList(this.env);
  }
}
