const CF_API="https://api.cloudflare.com/client/v4";
const clean=v=>String(v??"").trim();
function creds(env){return{accountId:clean(env?.CF_ACCOUNT_ID||env?.CLOUDFLARE_ACCOUNT_ID),token:clean(env?.CLOUDFLARE_AI_GATEWAY_API_TOKEN||env?.CF_API_TOKEN),gatewayId:clean(env?.AI_GATEWAY_ID||"test")}}
export async function readSanitizedGatewaySettings(env,fetchImpl=fetch){
  const c=creds(env);if(!c.accountId||!c.token||!c.gatewayId)throw new Error("AI_GATEWAY_SETTINGS_NOT_CONFIGURED");
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);let r,p;
  try{r=await fetchImpl(`${CF_API}/accounts/${encodeURIComponent(c.accountId)}/ai-gateway/gateways/${encodeURIComponent(c.gatewayId)}`,{headers:{authorization:`Bearer ${c.token}`,accept:"application/json"},signal:ctl.signal});p=await r.json().catch(()=>null)}finally{clearTimeout(timer)}
  if(!r?.ok||p?.success===false)throw new Error(`AI_GATEWAY_SETTINGS_HTTP_${r?.status||0}`);
  const x=p?.result||{};const spend=x?.spend_limits&&typeof x.spend_limits==="object"?x.spend_limits:{};const rules=Array.isArray(spend.rules)?spend.rules:[];
  return{ok:true,selftest:"ai-gateway-settings-sanitized-v1",gateway_id:c.gatewayId,rate_limiting_limit:Number(x?.rate_limiting_limit||0),rate_limiting_interval:Number(x?.rate_limiting_interval||0),rate_limiting_technique:String(x?.rate_limiting_technique||""),global_rate_limit_enabled:Number(x?.rate_limiting_limit||0)>0&&Number(x?.rate_limiting_interval||0)>0,retry_max_attempts:Number(x?.retry_max_attempts||0),retry_delay:Number(x?.retry_delay||0),retry_backoff:String(x?.retry_backoff||""),spend_limits_enabled:spend?.enabled===true,spend_rule_count:rules.length,has_active_spend_limit:spend?.enabled===true&&rules.length>0,collect_logs:x?.collect_logs===true,zdr:x?.zdr===true,secrets_redacted:true,payloads_read:false};
}
