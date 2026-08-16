import entry from "./entry.js";

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
function constantTimeEqual(a,b){a=String(a||"");b=String(b||"");if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
function authenticate(request,env){const h=request.headers.get("authorization")||"";if(!h.startsWith("Bearer "))return{ok:false,status:401,error:"UNAUTHORIZED"};if(!env.ADMIN_GPT_TOKEN)return{ok:false,status:503,error:"ADMIN_TOKEN_NOT_CONFIGURED"};return constantTimeEqual(h.slice(7).trim(),env.ADMIN_GPT_TOKEN)?{ok:true}:{ok:false,status:401,error:"UNAUTHORIZED"}}

function literatureActionPath(){
  return {
    post:{
      operationId:"runLiteratureProductionSelftest",
      summary:"Verify live OpenAlex, Semantic Scholar, and BASE production keys",
      description:"Run exactly one bounded live search against OpenAlex, Semantic Scholar, and BASE through the intelligence service binding. Returns per-provider PASS/FAIL without exposing API keys.",
      security:[{BearerAuth:[]}],
      requestBody:{required:false,content:{"application/json":{schema:{type:"object",additionalProperties:false}}}},
      responses:{
        "200":{description:"All three live keyed providers passed with non-empty results."},
        "401":{description:"Unauthorized."},
        "503":{description:"One or more production keys/providers failed, or the intelligence binding is unavailable."}
      }
    }
  };
}

function providerActionPath(){
  return {
    post:{
      operationId:"runProviderFreshE2E",
      summary:"Run fresh production E2E for Google Cloud, Earth Engine, Google Patents, and PKULaw",
      description:"Authenticated zero-AI production canary through the intelligence service binding. It executes the real /v1/run path sequentially, validates task receipts and lock release, uses BigQuery metadata only (no query scan), reads one Earth Engine public asset, performs one bounded Google Patents public search, and runs schema-aware PKULaw health. No secrets or upstream document bodies are returned.",
      security:[{BearerAuth:[]}],
      requestBody:{required:false,content:{"application/json":{schema:{type:"object",additionalProperties:false}}}},
      responses:{
        "200":{description:"All provider canaries passed with fresh runtime receipts."},
        "401":{description:"Unauthorized."},
        "503":{description:"One or more provider canaries failed, timed out, or the intelligence binding is unavailable."}
      }
    }
  };
}

async function runLiteratureSelftest(request,env){
  const auth=authenticate(request,env);if(!auth.ok)return json({ok:false,error:auth.error,http_status:auth.status},auth.status);
  const svc=env.INTELLIGENCE_CENTER;if(!svc?.fetch)return json({ok:false,error:"CENTER_UNCONFIGURED",center:"intelligence",http_status:503},503);
  const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);
  try{
    const r=await svc.fetch(new Request("https://intelligence.internal/v1/selftest/literature",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:"{}",signal:controller.signal}));
    const body=await r.json().catch(()=>null),ok=r.ok&&body?.ok===true;
    return json({ok,http_status:r.status,center:"intelligence",suite:"literature-production-keys",business_e2e:body?.business_e2e===true,selftest:body,elapsed_ms:Date.now()-started},ok?200:(r.status||503));
  }catch(error){const timeout=error?.name==="AbortError";return json({ok:false,error:timeout?"SELFTEST_TIMEOUT":"SELFTEST_FAILED",center:"intelligence",suite:"literature-production-keys",message:String(error?.message||error).slice(0,200),http_status:timeout?504:502,elapsed_ms:Date.now()-started},timeout?504:502)}finally{clearTimeout(timer)}
}

async function runProviderSelftest(request,env){
  const auth=authenticate(request,env);if(!auth.ok)return json({ok:false,error:auth.error,http_status:auth.status,ai_called:false},auth.status);
  const svc=env.INTELLIGENCE_CENTER;if(!svc?.fetch)return json({ok:false,error:"CENTER_UNCONFIGURED",center:"intelligence",suite:"provider-fresh-e2e",http_status:503,ai_called:false},503);
  const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
  try{
    const r=await svc.fetch(new Request("https://intelligence.internal/v1/selftest/providers",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:"{}",signal:controller.signal}));
    const body=await r.json().catch(()=>null),ok=r.ok&&body?.ok===true;
    return json({ok,http_status:r.status,center:"intelligence",suite:"provider-fresh-e2e",business_e2e:true,ai_called:false,bigquery_query_scan:body?.bigquery_query_scan===true,bigquery_bytes_billed:body?.bigquery_bytes_billed??null,receipt_digest:body?.receipt_digest||null,checks:Array.isArray(body?.checks)?body.checks:[],observed_at:body?.observed_at||null,secrets_redacted:true,elapsed_ms:Date.now()-started},ok?200:(r.status||503));
  }catch(error){const timeout=error?.name==="AbortError";return json({ok:false,error:timeout?"SELFTEST_TIMEOUT":"SELFTEST_FAILED",center:"intelligence",suite:"provider-fresh-e2e",message:String(error?.message||error).slice(0,200),http_status:timeout?504:502,ai_called:false,elapsed_ms:Date.now()-started},timeout?504:502)}finally{clearTimeout(timer)}
}

async function openApi(request,env,ctx){
  const response=await entry.fetch(request,env,ctx);if(!response.ok)return response;
  const spec=await response.json();
  return json({...spec,paths:{...(spec.paths||{}),"/v1/intelligence/literature-selftest":literatureActionPath(),"/v1/intelligence/provider-selftest":providerActionPath()}});
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="POST"&&url.pathname==="/v1/intelligence/literature-selftest")return runLiteratureSelftest(request,env);
    if(request.method==="POST"&&url.pathname==="/v1/intelligence/provider-selftest")return runProviderSelftest(request,env);
    if(request.method==="GET"&&url.pathname==="/openapi.json")return openApi(request,env,ctx);
    return entry.fetch(request,env,ctx);
  }
};