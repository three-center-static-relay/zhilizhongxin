const JSON_HEADERS={"content-type":"application/json;charset=utf-8","cache-control":"no-store"};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:JSON_HEADERS});

function executorBase(env){
  const raw=String(env.TENCENT_MAKERS_EXECUTOR_URL||"").trim();
  if(!raw)throw Object.assign(new Error("TENCENT_EXECUTOR_URL_NOT_CONFIGURED"),{status:503});
  let u;try{u=new URL(raw)}catch{throw Object.assign(new Error("TENCENT_EXECUTOR_URL_INVALID"),{status:503})}
  if(u.protocol!=="https:")throw Object.assign(new Error("TENCENT_EXECUTOR_URL_MUST_BE_HTTPS"),{status:503});
  return u;
}

function endpoint(env,path){
  const u=executorBase(env);
  u.pathname=path;
  return u;
}

function conversationId(prefix="c"){
  return `${prefix}_${crypto.randomUUID().replace(/-/g,"")}`.slice(0,36);
}

async function timedFetch(url,init={},timeoutMs=30000){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),timeoutMs);
  try{return await fetch(url,{...init,signal:c.signal,redirect:"follow"})}
  finally{clearTimeout(timer)}
}

function parseSseEvent(text,eventName){
  const blocks=String(text||"").split(/\r?\n\r?\n/);
  for(const block of blocks){
    const lines=block.split(/\r?\n/);
    let event="message";const data=[];
    for(const line of lines){
      if(line.startsWith("event:"))event=line.slice(6).trim();
      else if(line.startsWith("data:"))data.push(line.slice(5).trim());
    }
    if(event===eventName&&data.length){
      const raw=data.join("\n");
      try{return JSON.parse(raw)}catch{return {raw}}
    }
  }
  return null;
}

export function tencentExecutorStatus(env){
  const configured=Boolean(env.TENCENT_MAKERS_EXECUTOR_URL);
  return json({
    ok:configured,
    provider:"tencent-edgeone-makers",
    role:"agent-executor",
    project:String(env.TENCENT_MAKERS_PROJECT_NAME||"python-starter-agent"),
    executor_url_configured:configured,
    management_token_configured:Boolean(env.TENCENT_MAKERS_API_TOKEN),
    management_token_usage:"deployment-management-only",
    mode:String(env.TENCENT_MAKERS_EXECUTOR_MODE||"production"),
    secret_exposed:false
  },configured?200:503);
}

export async function tencentExecutorSelftest(env){
  const started=Date.now();
  const cid=conversationId("selftest");
  try{
    const healthResp=await timedFetch(endpoint(env,"/health"),{method:"GET",headers:{accept:"application/json"}},20000);
    const health=await healthResp.json().catch(()=>null);

    const capResp=await timedFetch(endpoint(env,"/capabilities"),{
      method:"POST",
      headers:{accept:"text/event-stream","content-type":"application/json","Makers-Conversation-Id":cid},
      body:"{}"
    },30000);
    const capText=await capResp.text();
    const capabilities=parseSseEvent(capText,"capabilities");

    const activeResp=await timedFetch(endpoint(env,"/runtime-selftest"),{
      method:"POST",
      headers:{accept:"text/event-stream","content-type":"application/json","Makers-Conversation-Id":cid},
      body:"{}"
    },90000);
    const activeText=await activeResp.text();
    const active=parseSseEvent(activeText,"selftest");
    const activeChecks=Array.isArray(active?.checks)?active.checks:[];
    const activeByName=Object.fromEntries(activeChecks.map(x=>[x?.name,x]));

    const families=capabilities?.families||{};
    const checks=[
      {name:"runtime_http",ok:healthResp.ok,observed:healthResp.status},
      {name:"python_runtime",ok:health?.ok===true&&health?.language==="python",observed:health?.python_version||null},
      {name:"capability_http",ok:capResp.ok,observed:capResp.status},
      {name:"sandbox_tools_visible",ok:capabilities?.ok===true&&Number(capabilities?.tool_count||0)>0,observed:Number(capabilities?.tool_count||0)},
      {name:"commands_visible",ok:families.commands===true,observed:families.commands===true},
      {name:"files_visible",ok:families.files===true,observed:families.files===true},
      {name:"code_visible",ok:families.code===true,observed:families.code===true},
      {name:"browser_visible",ok:families.browser===true,observed:families.browser===true},
      {name:"active_selftest_http",ok:activeResp.ok,observed:activeResp.status},
      {name:"shell_exec",ok:activeByName.shell?.ok===true,observed:activeByName.shell||null},
      {name:"file_rw_cleanup",ok:activeByName.files?.ok===true,observed:activeByName.files||null},
      {name:"python_exec",ok:activeByName.code_interpreter?.ok===true,observed:activeByName.code_interpreter||null},
      {name:"chromium_navigation",ok:activeByName.browser?.ok===true,observed:activeByName.browser||null}
    ];
    const ok=checks.every(x=>x.ok===true)&&active?.validation==="PASS";
    return json({
      ok,
      provider:"tencent-edgeone-makers",
      selftest:"executor-runtime-v2",
      validation:ok?"PASS":"FAIL",
      conversation_id:cid,
      checks,
      health,
      capabilities,
      active,
      elapsed_ms:Date.now()-started
    },ok?200:502);
  }catch(e){
    return json({
      ok:false,
      provider:"tencent-edgeone-makers",
      selftest:"executor-runtime-v2",
      validation:"FAIL",
      error:e?.name==="AbortError"?"TENCENT_EXECUTOR_TIMEOUT":String(e?.message||e),
      elapsed_ms:Date.now()-started
    },e?.status|| (e?.name==="AbortError"?504:502));
  }
}

export async function tencentAgentInvoke(req,env){
  let body;try{body=await req.json()}catch{return json({ok:false,error:"INVALID_JSON"},400)}
  const message=String(body?.message||"").trim();
  if(!message)return json({ok:false,error:"MESSAGE_REQUIRED"},400);
  if(message.length>10000)return json({ok:false,error:"MESSAGE_TOO_LONG"},400);
  const requested=String(body?.conversation_id||"").trim();
  const valid=/^[0-9A-Za-z_.-]{6,36}$/.test(requested);
  const cid=valid?requested:conversationId("agent");
  try{
    const upstream=await timedFetch(endpoint(env,"/chat"),{
      method:"POST",
      headers:{accept:"text/event-stream","content-type":"application/json","Makers-Conversation-Id":cid},
      body:JSON.stringify({message})
    },120000);
    const headers=new Headers(upstream.headers);
    headers.set("cache-control","no-store");
    headers.set("x-tencent-makers-conversation-id",cid);
    headers.delete("set-cookie");
    return new Response(upstream.body,{status:upstream.status,headers});
  }catch(e){
    return json({ok:false,error:e?.name==="AbortError"?"TENCENT_AGENT_TIMEOUT":"TENCENT_AGENT_FAILED",message:String(e?.message||e),conversation_id:cid},e?.name==="AbortError"?504:502);
  }
}
