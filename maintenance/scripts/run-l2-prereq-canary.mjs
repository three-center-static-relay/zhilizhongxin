#!/usr/bin/env node
const COMMIT_PATTERN=/^[a-f0-9]{40}$/i;
function clean(value,max=120){return String(value??"").replace(/[^0-9A-Za-z._:/,=@+-]/g,"_").slice(0,max)}
try{
  const commit=String(process.env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!COMMIT_PATTERN.test(commit))throw new Error("SECRET_CANARY_COMMIT_SHA_INVALID");
  const token=String(process.env.CLOUDFLARE_AI_GATEWAY_API_TOKEN||"").trim();
  if(!token)throw new Error("SECRET_CANARY_AI_GATEWAY_TOKEN_MISSING");
  console.log(JSON.stringify({event:"L2_SECRET_CANARY_PASS",ok:true,commit_sha:commit,ai_gateway_build_secret_present:true,token_length_class:token.length>=20?"normal":"short",route_mutation:false,network_request:false,worker_mutation:false,secrets_redacted:true}));
}catch(error){console.error(JSON.stringify({event:"L2_SECRET_CANARY_FAIL",ok:false,error:clean(error?.message||error),route_mutation:false,network_request:false,worker_mutation:false,secrets_redacted:true}));process.exitCode=1}
