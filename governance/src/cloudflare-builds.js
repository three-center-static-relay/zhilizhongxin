const API_BASE="https://api.cloudflare.com/client/v4";
const MAX_RESPONSE_BYTES=524288;
const REQUEST_TIMEOUT_MS=12000;
const ADMIN_OPERATION_LEASE_SECONDS=180;

export const CANDIDATE_CENTERS=Object.freeze([
  ["governance","governance-worker"],
  ["intelligence","intelligence-worker"],
  ["compute","compute-worker"],
  ["expert","expert-worker"]
]);

function configuration(env){
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||"").trim();
  const token=String(env.CLOUDFLARE_BUILDS_API_TOKEN||"").trim();
  if(!accountId||!token)throw Object.assign(new Error("CLOUDFLARE_BUILDS_NOT_CONFIGURED"),{status:503,details:{account_id_configured:Boolean(accountId),api_token_configured:Boolean(token)}});
  return {accountId,token};
}

function redact(value){
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==="object"){
    const out={};
    for(const [key,item] of Object.entries(value))out[key]=/token|secret|authorization|cookie|password|api.?key/i.test(key)?"[REDACTED]":redact(item);
    return out;
  }
  return value;
}

async function api(env,path,{method="GET",body}={}){
  const {accountId,token}=configuration(env);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const response=await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}${path}`,{
      method,
      headers:{authorization:`Bearer ${token}`,accept:"application/json",...(body!==undefined?{"content-type":"application/json"}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),
      signal:controller.signal
    });
    const text=await response.text();
    if(new TextEncoder().encode(text).length>MAX_RESPONSE_BYTES)throw Object.assign(new Error("CLOUDFLARE_API_RESPONSE_TOO_LARGE"),{status:502});
    let payload=null;
    if(text){try{payload=JSON.parse(text)}catch{throw Object.assign(new Error("CLOUDFLARE_API_BAD_JSON"),{status:502})}}
    if(!response.ok||payload?.success===false){
      const error=Object.assign(new Error("CLOUDFLARE_API_ERROR"),{status:response.status||502,details:redact({errors:payload?.errors||null,messages:payload?.messages||null})});
      throw error;
    }
    return payload?.result??payload;
  }catch(error){
    if(error?.name==="AbortError")throw Object.assign(new Error("CLOUDFLARE_API_TIMEOUT"),{status:504});
    throw error;
  }finally{clearTimeout(timer)}
}

function adminState(env){
  if(!env.ADMIN_STATE?.get||!env.ADMIN_STATE?.idFromName)throw Object.assign(new Error("ADMIN_STATE_UNAVAILABLE"),{status:503});
  return env.ADMIN_STATE.get(env.ADMIN_STATE.idFromName("global"));
}
async function stateJson(env,path,{method="GET",body}={}){
  const stub=adminState(env),init={method,headers:{accept:"application/json",...(body!==undefined?{"content-type":"application/json"}:{})};
  if(body!==undefined)init.body=JSON.stringify(body);
  const response=await stub.fetch(new Request(`https://admin-state.internal${path}`,init));
  const payload=await response.json().catch(()=>({ok:false,error:"ADMIN_STATE_BAD_RESPONSE"}));
  return {http_status:response.status,body:payload};
}
async function acquireOperation(env,kind){
  const owner=`${kind}-${crypto.randomUUID()}`;
  const result=await stateJson(env,"/operation-lock/acquire",{method:"POST",body:{owner,kind,lease_seconds:ADMIN_OPERATION_LEASE_SECONDS}});
  if(result.http_status===409)throw Object.assign(new Error("ADMIN_OPERATION_BUSY"),{status:409,details:{active:result.body?.active||null}});
  if(result.http_status!==200||result.body?.ok!==true)throw Object.assign(new Error(result.body?.error||"ADMIN_STATE_UNAVAILABLE"),{status:result.http_status||503});
  return owner;
}
async function releaseOperation(env,owner){
  if(!owner)return false;
  try{const result=await stateJson(env,"/operation-lock/release",{method:"POST",body:{owner}});return result.http_status===200&&result.body?.ok===true}catch{return false}
}
async function releaseCurrentCandidateOperation(env){
  try{
    const current=await stateJson(env,"/operation-lock"),active=current.body?.active;
    if(current.http_status!==200||!active||!["candidate-build","candidate-validation"].includes(String(active.kind||"")))return false;
    return releaseOperation(env,String(active.owner||""));
  }catch{return false}
}

function safePreviewTrigger(trigger){
  const deploy=String(trigger?.deploy_command||"").toLowerCase();
  const excludes=Array.isArray(trigger?.branch_excludes)?trigger.branch_excludes.map(String):[];
  return Boolean(trigger?.trigger_uuid)&&excludes.includes("main")&&/wrangler\s+versions\s+upload/.test(deploy);
}

async function resolvePreviewTrigger(env,scriptName){
  const scripts=await api(env,"/workers/scripts");
  const list=Array.isArray(scripts)?scripts:Array.isArray(scripts?.result)?scripts.result:[];
  const script=list.find(item=>String(item?.id||"")===scriptName);
  const tag=String(script?.tag||"");
  if(!tag)throw Object.assign(new Error("WORKER_TAG_NOT_FOUND"),{status:503,details:{script_name:scriptName}});
  const triggers=await api(env,`/builds/workers/${encodeURIComponent(tag)}/triggers`);
  const triggerList=Array.isArray(triggers)?triggers:Array.isArray(triggers?.result)?triggers.result:[];
  const preview=triggerList.find(safePreviewTrigger);
  if(!preview)throw Object.assign(new Error("SAFE_PREVIEW_TRIGGER_NOT_FOUND"),{status:503,details:{script_name:scriptName,worker_tag:tag}});
  return {script_name:scriptName,worker_tag:tag,trigger_uuid:String(preview.trigger_uuid),deploy_command:String(preview.deploy_command||""),branch_excludes:Array.isArray(preview.branch_excludes)?preview.branch_excludes:[]};
}

function validateBranch(branch){
  const value=String(branch||"").trim();
  if(!value||value.length>200||value==="main"||/\s/.test(value))throw Object.assign(new Error("INVALID_CANDIDATE_BRANCH"),{status:400});
  return value;
}
function validateCommit(commit){
  const value=String(commit||"").trim().toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(value))throw Object.assign(new Error("INVALID_COMMIT_SHA"),{status:400});
  return value;
}

async function cancelBuild(env,buildUuid){
  try{await api(env,`/builds/builds/${encodeURIComponent(buildUuid)}/cancel`,{method:"PUT"});return true}catch{return false}
}

export async function cancelCandidateBuilds(env,builds){
  const results=[];
  for(const [center] of CANDIDATE_CENTERS){
    const buildUuid=String(builds?.[center]?.build_uuid||"");
    if(!buildUuid)continue;
    results.push({center,build_uuid:buildUuid,cancelled:await cancelBuild(env,buildUuid)});
  }
  await releaseCurrentCandidateOperation(env);
  return results;
}

export async function triggerCandidateBuilds(env,{branch,commits}){
  const candidateBranch=validateBranch(branch);
  const normalizedCommits={};
  for(const [center] of CANDIDATE_CENTERS)normalizedCommits[center]=validateCommit(commits?.[center]);
  configuration(env);
  const lockOwner=await acquireOperation(env,"candidate-build");
  const builds={},triggered=[];
  try{
    for(const [center,scriptName] of CANDIDATE_CENTERS){
      const trigger=await resolvePreviewTrigger(env,scriptName);
      const result=await api(env,`/builds/triggers/${encodeURIComponent(trigger.trigger_uuid)}/builds`,{method:"POST",body:{branch:candidateBranch,commit_hash:normalizedCommits[center]}});
      if(result?.already_exists===true)throw Object.assign(new Error("CANDIDATE_BRANCH_BUILD_ALREADY_PENDING"),{status:409,details:{center,script_name:scriptName,existing_build_uuid:String(result?.build_uuid||"")||null}});
      const buildUuid=String(result?.build_uuid||"");
      if(!buildUuid)throw Object.assign(new Error("BUILD_UUID_MISSING"),{status:502,details:{center,script_name:scriptName}});
      builds[center]={center,script_name:scriptName,worker_tag:trigger.worker_tag,trigger_uuid:trigger.trigger_uuid,branch:candidateBranch,commit_hash:normalizedCommits[center],build_uuid:buildUuid,created_on:result?.created_on||null,deploy_command:trigger.deploy_command};
      triggered.push(buildUuid);
    }
    // Keep the lock until AdminState persists the candidate record. AdminState releases
    // candidate-build locks atomically after successful candidate storage.
    return {branch:candidateBranch,commits:normalizedCommits,builds,operation_lock_owner:lockOwner};
  }catch(error){
    const cancelled=[];
    for(const buildUuid of triggered)cancelled.push({build_uuid:buildUuid,cancelled:await cancelBuild(env,buildUuid)});
    await releaseOperation(env,lockOwner);
    throw Object.assign(error,{details:{...(error?.details||{}),partial_builds_cancelled:cancelled}});
  }
}

function buildState(build,expected){
  const metadata=build?.build_trigger_metadata||{};
  const trigger=build?.trigger||{};
  const status=String(build?.status||"");
  const outcome=String(build?.build_outcome||"");
  const deploy=String(metadata?.deploy_command||trigger?.deploy_command||expected?.deploy_command||"").toLowerCase();
  const terminal=status==="stopped";
  return {
    build_uuid:String(build?.build_uuid||expected?.build_uuid||""),
    status,
    build_outcome:outcome||null,
    terminal,
    success:terminal&&outcome==="success",
    branch:String(metadata?.branch||""),
    commit_hash:String(metadata?.commit_hash||"").toLowerCase(),
    branch_matches:String(metadata?.branch||"")===String(expected?.branch||""),
    commit_matches:String(metadata?.commit_hash||"").toLowerCase()===String(expected?.commit_hash||"").toLowerCase(),
    safe_preview_deploy:/wrangler\s+versions\s+upload/.test(deploy),
    created_on:build?.created_on||null,
    stopped_on:build?.stopped_on||null
  };
}

export async function inspectCandidateBuilds(env,builds){
  configuration(env);
  const lockOwner=await acquireOperation(env,"candidate-validation");
  try{
    const states={};
    for(const [center] of CANDIDATE_CENTERS){
      const expected=builds?.[center];
      if(!expected?.build_uuid)throw Object.assign(new Error("CANDIDATE_BUILD_RECORD_INCOMPLETE"),{status:500,details:{center}});
      const result=await api(env,`/builds/builds/${encodeURIComponent(expected.build_uuid)}`);
      states[center]=buildState(result,expected);
    }
    const pending=Object.values(states).some(item=>!item.terminal);
    if(pending)await releaseOperation(env,lockOwner);
    // Terminal validation keeps the lock until AdminState stores the immutable acceptance.
    return {pending,states,operation_lock_owner:pending?null:lockOwner};
  }catch(error){
    await releaseOperation(env,lockOwner);
    throw error;
  }
}
