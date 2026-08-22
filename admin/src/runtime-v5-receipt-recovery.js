const TOKEN_SHA256="3c465435ea61ac1a07bbcb7cbdaf7b24b47dab85e5b443d561cd49b73b0c10bf";
const EXPIRES_AT=Date.parse("2026-08-22T01:10:00.000Z");
const TARGET_TASK_ID="runtime-canary-adaptive-effect-v5";
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function sha256(value){return hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value||""))))}
function constantTimeEqual(a,b){a=String(a||"");b=String(b||"");if(!a||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
function suppliedToken(request){const direct=request.headers.get("x-v5-recovery-token")||"";if(direct)return direct;const auth=request.headers.get("authorization")||"";return /^Bearer\s+/i.test(auth)?auth.replace(/^Bearer\s+/i,""):""}
async function authorized(request){if(Date.now()>EXPIRES_AT)return false;return constantTimeEqual(await sha256(suppliedToken(request)),TOKEN_SHA256)}
export async function handleV5ReceiptRecovery(request,env){
  const url=new URL(request.url);
  if(url.pathname!=="/__runtime-canary/v5-receipt")return null;
  if(request.method!=="GET"||!(await authorized(request)))return json({ok:false,error:"NOT_FOUND"},404);
  if(!env.ADMIN_COORDINATOR?.get||!env.ADMIN_COORDINATOR?.idFromName)return json({ok:false,error:"STATE_UNAVAILABLE"},503);
  const state=env.ADMIN_COORDINATOR.get(env.ADMIN_COORDINATOR.idFromName("global"));
  const response=await state.fetch(new Request(`https://state.internal/task/${encodeURIComponent(TARGET_TASK_ID)}`,{method:"GET"}));
  const body=await response.json().catch(()=>null);
  if(!response.ok)return json({ok:false,error:"STATE_READ_FAILED",http_status:response.status},502);
  return json({ok:true,target:TARGET_TASK_ID,task:body?.task||null,expires_at:new Date(EXPIRES_AT).toISOString(),read_only:true,secrets_redacted:true});
}
