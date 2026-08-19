#!/usr/bin/env node
const COMMIT_PATTERN=/^[a-f0-9]{40}$/i;
const CF_API="https://api.cloudflare.com/client/v4";
function clean(value,max=160){return String(value??"").replace(/[^0-9A-Za-z._:/,=@+-]/g,"_").slice(0,max)}
async function main(){
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!COMMIT_PATTERN.test(commit))throw new Error("PREREQ_COMMIT_SHA_INVALID");
  const token=String(process.env.CLOUDFLARE_AI_GATEWAY_API_TOKEN||"").trim();
  if(!token)throw new Error("PREREQ_AI_GATEWAY_BUILD_SECRET_MISSING");
  const accountId=String(process.env.CLOUDFLARE_ACCOUNT_ID||"e3aec027af13c557bbcb831d29c1e7b4").trim();
  const gatewayId=String(process.env.AI_GATEWAY_ID||"test").trim();
  if(!accountId||!gatewayId)throw new Error("PREREQ_GATEWAY_CONTEXT_MISSING");
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
  let response,payload;
  try{
    response=await fetch(`${CF_API}/accounts/${encodeURIComponent(accountId)}/ai-gateway/gateways/${encodeURIComponent(gatewayId)}/routes?per_page=1`,{headers:{authorization:`Bearer ${token}`,accept:"application/json"},signal:controller.signal});
    payload=await response.json().catch(()=>null);
  }finally{clearTimeout(timer)}
  if(!response.ok||payload?.success===false){
    const code=Array.isArray(payload?.errors)&&payload.errors[0]?.code!=null?clean(payload.errors[0].code,40):null;
    throw new Error(`PREREQ_ROUTE_LIST_FAILED:${response.status}${code?`:CF_${code}`:""}`);
  }
  console.log(JSON.stringify({event:"L2_PREREQ_CANARY_PASS",ok:true,commit_sha:commit,ai_gateway_build_secret_present:true,control_plane_read_ok:true,http_status:response.status,gateway_id:gatewayId,route_mutation:false,worker_mutation:false,secrets_redacted:true}));
}
main().catch(error=>{console.error(JSON.stringify({event:"L2_PREREQ_CANARY_FAIL",ok:false,error:clean(error?.message||error),route_mutation:false,worker_mutation:false,secrets_redacted:true}));process.exitCode=1});
