import {MaintenanceState} from "./index.js";
export {MaintenanceState};

const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
function constantTimeEqual(a,b){a=String(a||"");b=String(b||"");if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}

export default{
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method!=="GET"||url.pathname!=="/v1/maintenance/neon-e2e")return json({ok:false,error:"NOT_FOUND"},404);
    const expected=String(env.NEON_E2E_PROBE||"");
    const supplied=request.headers.get("x-neon-e2e-probe")||"";
    if(!expected||!constantTimeEqual(expected,supplied))return json({ok:false,error:"UNAUTHORIZED"},401);
    if(!env.GOVERNANCE_CENTER?.fetch)return json({ok:false,error:"GOVERNANCE_CENTER_UNBOUND",secrets_redacted:true},503);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await env.GOVERNANCE_CENTER.fetch(new Request("https://governance.internal/_internal/neon-memory-e2e",{method:"POST",headers:{accept:"application/json","x-three-center-selftest":"1"},signal:controller.signal}));
      const body=await response.json().catch(()=>null);
      const ok=response.status===200&&body?.ok===true&&body?.selftest==="neon-memory-runtime-e2e-v1"&&body?.configured===true&&body?.connection_ok===true&&body?.bootstrap_ok===true&&body?.write_ok===true&&body?.readback_ok===true&&body?.digest_match===true&&body?.cleanup_ok===true&&Number(body?.records_left||0)===0&&body?.secret_exposed===false&&body?.secrets_redacted===true;
      return json({ok,selftest:"maintenance-neon-memory-e2e-v1",governance_http_status:response.status,provider:body?.provider||null,schema:body?.schema||null,configured:body?.configured===true,connection_ok:body?.connection_ok===true,bootstrap_ok:body?.bootstrap_ok===true,write_ok:body?.write_ok===true,readback_ok:body?.readback_ok===true,digest_match:body?.digest_match===true,cleanup_ok:body?.cleanup_ok===true,records_left:Number(body?.records_left||0),secret_exposed:false,secrets_redacted:true,production_mutation:false},ok?200:502);
    }catch(error){
      return json({ok:false,selftest:"maintenance-neon-memory-e2e-v1",error:error?.name==="AbortError"?"NEON_E2E_TIMEOUT":"NEON_E2E_FAILED",secret_exposed:false,secrets_redacted:true,production_mutation:false},502);
    }finally{clearTimeout(timer)}
  }
};
