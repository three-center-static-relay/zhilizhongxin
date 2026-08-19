const API_BASE="https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS=10000;
const MAX_RESPONSE_BYTES=524288;
const RECENT_BUILD_LIMIT=5;
const FAILURE_TAIL_LINES=120;
const MAX_LOG_PAGES=8;
const MONITORED_WORKERS=Object.freeze(["governance-worker","admin-worker","maintenance-worker"]);

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

function configuration(env){
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||"").trim();
  const token=String(env.CLOUDFLARE_BUILDS_API_TOKEN||"").trim();
  if(!accountId||!token)throw Object.assign(new Error("CLOUDFLARE_BUILDS_NOT_CONFIGURED"),{status:503,details:{account_id_configured:Boolean(accountId),api_token_configured:Boolean(token)}});
  return {accountId,token};
}

function redactText(value){
  return String(value||"")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,"Bearer [REDACTED]")
    .replace(/\b((?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)\s*[:=]\s*)[^\s,;]+/gi,"$1[REDACTED]");
}

function redact(value){
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==="object"){
    const out={};
    for(const [key,item] of Object.entries(value))out[key]=/token|secret|authorization|cookie|password|api.?key/i.test(key)?"[REDACTED]":redact(item);
    return out;
  }
  return typeof value==="string"?redactText(value):value;
}

async function cfApi(env,path){
  const {accountId,token}=configuration(env);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const response=await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}${path}`,{method:"GET",headers:{authorization:`Bearer ${token}`,accept:"application/json"},signal:controller.signal});
    const text=await response.text();
    if(new TextEncoder().encode(text).length>MAX_RESPONSE_BYTES)throw Object.assign(new Error("CLOUDFLARE_API_RESPONSE_TOO_LARGE"),{status:502});
    let payload=null;
    if(text){try{payload=JSON.parse(text)}catch{throw Object.assign(new Error("CLOUDFLARE_API_BAD_JSON"),{status:502})}}
    if(!response.ok||payload?.success===false)throw Object.assign(new Error("CLOUDFLARE_API_ERROR"),{status:response.status||502,details:redact({errors:payload?.errors||null,messages:payload?.messages||null})});
    return payload?.result??payload;
  }catch(error){
    if(error?.name==="AbortError")throw Object.assign(new Error("CLOUDFLARE_API_TIMEOUT"),{status:504});
    throw error;
  }finally{clearTimeout(timer)}
}

function rows(payload){
  if(Array.isArray(payload))return payload;
  for(const key of ["builds","result","data"])if(Array.isArray(payload?.[key]))return payload[key];
  return [];
}

function createdTime(build){
  const raw=build?.created_at||build?.created_on||build?.createdAt||build?.created||"";
  const n=Date.parse(String(raw||""));
  return Number.isFinite(n)?n:0;
}

function normalizedBuild(build){
  const metadata=build?.build_trigger_metadata||build?.buildTriggerMetadata||build?.trigger||{};
  const status=String(build?.status||"").toLowerCase();
  const outcome=String(build?.build_outcome||build?.buildOutcome||"").toLowerCase();
  const commitHash=String(metadata?.commit_hash||metadata?.commitHash||build?.commit_hash||build?.commitHash||"").trim().toLowerCase();
  const branch=String(metadata?.branch||build?.branch||"").trim();
  const success=outcome==="success";
  const failed=["fail","failed","failure"].includes(outcome);
  const canceled=["cancelled","canceled"].includes(outcome);
  const terminated=outcome==="terminated";
  const skipped=outcome==="skipped";
  const terminal=status==="stopped"||success||failed||canceled||terminated||skipped;
  const state=success?"SUCCESS":failed?"FAILED":canceled?"CANCELED":terminated?"TERMINATED":skipped?"SKIPPED":status==="stopped"?"STOPPED":["queued","initializing","running"].includes(status)?status.toUpperCase():"UNKNOWN";
  return {
    build_uuid:String(build?.build_uuid||build?.buildUuid||build?.id||"").trim()||null,
    state,status:status||null,build_outcome:outcome||null,terminal,success,failed,canceled,terminated,skipped,
    branch:branch||null,commit_hash:commitHash||null,
    created_at:build?.created_at||build?.created_on||build?.createdAt||null,
    initializing_at:build?.initializing_at||build?.initializing_on||build?.initializingAt||null,
    running_at:build?.running_at||build?.running_on||build?.runningAt||null,
    stopped_at:build?.stopped_at||build?.stopped_on||build?.stoppedAt||null
  };
}

function logLines(payload){
  let source=payload;
  if(payload&&typeof payload==="object"&&!Array.isArray(payload))source=payload.lines??payload.logs??payload.data??payload.result??payload;
  if(Array.isArray(source))return source.map(item=>{
    if(typeof item==="string")return redactText(item);
    if(Array.isArray(item))return redactText(item.map(part=>String(part??"")).join(" "));
    if(item&&typeof item==="object"){
      const candidate=item.message??item.line??item.text??item.log;
      if(typeof candidate==="string")return redactText(candidate);
    }
    return redactText(JSON.stringify(redact(item)));
  });
  if(typeof source==="string")return redactText(source).split(/\r?\n/);
  return redactText(JSON.stringify(redact(source))).split(/\r?\n/);
}

async function buildLogTail(env,buildUuid){
  let cursor=null,pages=0,all=[],apiTruncated=false;
  do{
    const suffix=cursor?`?cursor=${encodeURIComponent(cursor)}`:"";
    const payload=await cfApi(env,`/builds/builds/${encodeURIComponent(buildUuid)}/logs${suffix}`);
    all.push(...logLines(payload));
    cursor=String(payload?.cursor||"").trim()||null;
    apiTruncated=payload?.truncated===true;
    pages++;
  }while(cursor&&pages<MAX_LOG_PAGES);
  return {tail_lines:FAILURE_TAIL_LINES,total_lines_observed:all.length,log_tail:all.slice(-FAILURE_TAIL_LINES),truncated:apiTruncated||Boolean(cursor)||all.length>FAILURE_TAIL_LINES,pages_observed:pages};
}

async function workerTags(env){
  const scripts=rows(await cfApi(env,"/workers/scripts"));
  const tags={};
  for(const worker of MONITORED_WORKERS){
    const script=scripts.find(item=>String(item?.id||"")===worker);
    const tag=String(script?.tag||script?.external_script_id||"").trim();
    if(tag)tags[worker]=tag;
  }
  return tags;
}

async function inspectWorker(env,worker,tag){
  if(!tag)return {ok:false,worker,error:"WORKER_TAG_NOT_FOUND",recent_builds:[],latest:null,latest_failure_logs:null,secrets_redacted:true};
  try{
    const builds=rows(await cfApi(env,`/builds/workers/${encodeURIComponent(tag)}/builds`)).slice().sort((a,b)=>createdTime(b)-createdTime(a)).slice(0,RECENT_BUILD_LIMIT).map(normalizedBuild);
    const latest=builds[0]||null;
    let latestFailureLogs=null;
    if(latest?.build_uuid&&(latest.failed||latest.canceled||latest.terminated))latestFailureLogs=await buildLogTail(env,latest.build_uuid);
    return {ok:true,worker,worker_tag:tag,latest,recent_builds:builds,latest_failure_logs:latestFailureLogs,secrets_redacted:true};
  }catch(error){
    return {ok:false,worker,error:String(error?.message||"BUILD_STATUS_FAILED"),http_status:error?.status||500,details:redact(error?.details||null),recent_builds:[],latest:null,latest_failure_logs:null,secrets_redacted:true};
  }
}

export async function collectBuildFastStatus(env){
  try{
    const tags=await workerTags(env);
    const entries=await Promise.all(MONITORED_WORKERS.map(async worker=>[worker,await inspectWorker(env,worker,tags[worker])]));
    const workers=Object.fromEntries(entries);
    return {ok:Object.values(workers).every(item=>item.ok===true),source:"cloudflare-builds-api",bot_independent:true,observed_at:new Date().toISOString(),recent_build_limit:RECENT_BUILD_LIMIT,workers,secrets_redacted:true};
  }catch(error){
    return {ok:false,source:"cloudflare-builds-api",bot_independent:true,observed_at:new Date().toISOString(),error:String(error?.message||"CLOUDFLARE_BUILDS_STATUS_FAILED"),http_status:error?.status||500,details:redact(error?.details||null),workers:{},secrets_redacted:true};
  }
}

export async function enrichSystemHealthWithBuilds(response,env){
  if(!response?.ok)return response;
  const fallback=response.clone();
  const body=await response.json().catch(()=>null);
  if(!body||typeof body!=="object")return fallback;
  const cloudflare_builds=await collectBuildFastStatus(env);
  return json({...body,data:{...(body.data||{}),cloudflare_builds}},response.status);
}
