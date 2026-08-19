const API_BASE="https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS=10000;
const MAX_RESPONSE_BYTES=524288;
const DEFAULT_TAIL_LINES=120;
const MAX_TAIL_LINES=300;
const MAX_LOG_PAGES=8;
const ALLOWED_WORKERS=new Set([
  "governance-worker",
  "admin-worker",
  "maintenance-worker",
  "intelligence-worker",
  "compute-worker",
  "expert-worker"
]);

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});

function constantTimeEqual(a,b){
  a=String(a||"");b=String(b||"");
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}

function authenticate(request,env){
  const authorization=request.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))return {ok:false,status:401,error:"UNAUTHORIZED"};
  if(!env.ADMIN_GPT_TOKEN)return {ok:false,status:503,error:"ADMIN_TOKEN_NOT_CONFIGURED"};
  return constantTimeEqual(authorization.slice(7).trim(),env.ADMIN_GPT_TOKEN)?{ok:true}:{ok:false,status:401,error:"UNAUTHORIZED"};
}

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

function normalizeWorker(value){
  const worker=String(value||"").trim();
  if(!ALLOWED_WORKERS.has(worker))throw Object.assign(new Error("INVALID_WORKER"),{status:400});
  return worker;
}

function normalizeCommit(value){
  if(value===null||value===undefined||value==="")return null;
  const commit=String(value).trim().toLowerCase();
  if(!/^[a-f0-9]{7,40}$/.test(commit))throw Object.assign(new Error("INVALID_COMMIT"),{status:400});
  return commit;
}

function tailCount(value){
  if(value===null||value===undefined||value==="")return DEFAULT_TAIL_LINES;
  const n=Number(value);
  if(!Number.isInteger(n)||n<20||n>MAX_TAIL_LINES)throw Object.assign(new Error("INVALID_TAIL"),{status:400});
  return n;
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
  const terminal=status==="stopped"||["success","fail","failed","failure","skipped","cancelled","canceled","terminated"].includes(outcome);
  const success=outcome==="success";
  const failed=["fail","failed","failure"].includes(outcome);
  const canceled=["cancelled","canceled"].includes(outcome);
  const terminated=outcome==="terminated";
  const skipped=outcome==="skipped";
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

async function resolveWorkerTag(env,worker){
  const scripts=rows(await cfApi(env,"/workers/scripts"));
  const script=scripts.find(item=>String(item?.id||"")===worker);
  const tag=String(script?.tag||script?.external_script_id||"").trim();
  if(!tag)throw Object.assign(new Error("WORKER_TAG_NOT_FOUND"),{status:404,details:{worker}});
  return tag;
}

function logLines(payload){
  let source=payload;
  if(payload&&typeof payload==="object"&&!Array.isArray(payload))source=payload.lines??payload.logs??payload.data??payload.result??payload;
  if(Array.isArray(source)){
    return source.map(item=>{
      if(typeof item==="string")return redactText(item);
      if(Array.isArray(item))return redactText(item.map(part=>String(part??"")).join(" "));
      if(item&&typeof item==="object"){
        const candidate=item.message??item.line??item.text??item.log;
        if(typeof candidate==="string")return redactText(candidate);
      }
      return redactText(JSON.stringify(redact(item)));
    });
  }
  if(typeof source==="string")return redactText(source).split(/\r?\n/);
  return redactText(JSON.stringify(redact(source))).split(/\r?\n/);
}

async function buildLogTail(env,buildUuid,tail){
  let cursor=null,pages=0,all=[],apiTruncated=false;
  do{
    const suffix=cursor?`?cursor=${encodeURIComponent(cursor)}`:"";
    const payload=await cfApi(env,`/builds/builds/${encodeURIComponent(buildUuid)}/logs${suffix}`);
    all.push(...logLines(payload));
    cursor=String(payload?.cursor||"").trim()||null;
    apiTruncated=payload?.truncated===true;
    pages++;
  }while(cursor&&pages<MAX_LOG_PAGES);
  return {tail_lines:tail,total_lines_observed:all.length,log_tail:all.slice(-tail),truncated:apiTruncated||Boolean(cursor)||all.length>tail,pages_observed:pages};
}

async function authorized(request,env,fn){
  const auth=authenticate(request,env);
  if(!auth.ok)return json({ok:false,error:auth.error,http_status:auth.status},auth.status);
  try{return json(await fn(),200)}catch(error){return json({ok:false,error:String(error?.message||"BUILD_FASTPATH_FAILED"),http_status:error?.status||500,details:error?.details||undefined,secrets_redacted:true},error?.status||500)}
}

export async function getBuildFastStatus(request,env){
  return authorized(request,env,async()=>{
    const url=new URL(request.url);
    const worker=normalizeWorker(url.searchParams.get("worker"));
    const commit=normalizeCommit(url.searchParams.get("commit"));
    const tail=tailCount(url.searchParams.get("tail"));
    const workerTag=await resolveWorkerTag(env,worker);
    const list=rows(await cfApi(env,`/builds/workers/${encodeURIComponent(workerTag)}/builds`)).slice().sort((a,b)=>createdTime(b)-createdTime(a));
    const selected=commit?list.find(item=>String(normalizedBuild(item).commit_hash||"").startsWith(commit)):list[0];
    if(!selected)return {ok:true,http_status:200,found:false,state:"NOT_OBSERVED",worker,commit,source:"cloudflare-builds-api",bot_independent:true,observed_at:new Date().toISOString(),secrets_redacted:true};
    const build=normalizedBuild(selected);
    let logs=null;
    if((build.failed||build.canceled||build.terminated)&&build.build_uuid)logs=await buildLogTail(env,build.build_uuid,tail);
    return {ok:true,http_status:200,found:true,worker,worker_tag:workerTag,requested_commit:commit,build,logs,source:"cloudflare-builds-api",bot_independent:true,observed_at:new Date().toISOString(),secrets_redacted:true};
  });
}

export async function getBuildLogTail(request,env){
  return authorized(request,env,async()=>{
    const url=new URL(request.url);
    const buildUuid=String(url.searchParams.get("build_uuid")||"").trim();
    if(!/^[A-Za-z0-9-]{16,96}$/.test(buildUuid))throw Object.assign(new Error("INVALID_BUILD_UUID"),{status:400});
    const tail=tailCount(url.searchParams.get("tail"));
    return {ok:true,http_status:200,build_uuid:buildUuid,...(await buildLogTail(env,buildUuid,tail)),source:"cloudflare-builds-api",bot_independent:true,observed_at:new Date().toISOString(),secrets_redacted:true};
  });
}

export function buildFastOpenApiPaths(){
  return {
    "/v1/admin/builds/fast-status":{get:{operationId:"getCloudflareBuildFastStatus",summary:"Read live Cloudflare Workers Build status",description:"Read the latest Cloudflare Workers Build directly from the Builds API, optionally pinned to a commit prefix. Failed, canceled, or terminated builds automatically include a redacted log tail. This bypasses delayed GitHub bot synchronization and never triggers or cancels builds.",security:[{BearerAuth:[]}],parameters:[{name:"worker",in:"query",required:true,schema:{type:"string",enum:[...ALLOWED_WORKERS]}},{name:"commit",in:"query",required:false,schema:{type:"string",pattern:"^[A-Fa-f0-9]{7,40}$"}},{name:"tail",in:"query",required:false,schema:{type:"integer",minimum:20,maximum:MAX_TAIL_LINES,default:DEFAULT_TAIL_LINES}}],responses:{"200":{description:"Current Build status or NOT_OBSERVED."},"400":{description:"Invalid worker, commit, or tail."},"401":{description:"Unauthorized."},"503":{description:"Builds API credentials unavailable."}}}},
    "/v1/admin/builds/logs":{get:{operationId:"getCloudflareBuildLogTail",summary:"Read a redacted Cloudflare Build log tail",description:"Read a bounded, cursor-aware tail of one Cloudflare Workers Build log by build UUID. Sensitive-looking fields and bearer/token strings are redacted before return.",security:[{BearerAuth:[]}],parameters:[{name:"build_uuid",in:"query",required:true,schema:{type:"string",minLength:16,maxLength:96}},{name:"tail",in:"query",required:false,schema:{type:"integer",minimum:20,maximum:MAX_TAIL_LINES,default:DEFAULT_TAIL_LINES}}],responses:{"200":{description:"Redacted Build log tail."},"400":{description:"Invalid build_uuid or tail."},"401":{description:"Unauthorized."},"503":{description:"Builds API credentials unavailable."}}}}
  };
}
