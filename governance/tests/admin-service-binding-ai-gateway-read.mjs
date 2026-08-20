import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../src/admin-entry.js";

const config=JSON.parse(fs.readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
const adminBinding=(config.services||[]).find(x=>x.binding==="ADMIN_CENTER");
const namedBinding=(config.services||[]).find(x=>x.binding==="AI_GATEWAY_CONTROL");
assert.equal(adminBinding?.service,"admin-worker");
assert.equal(adminBinding?.entrypoint,undefined);
assert.equal(namedBinding,undefined);

let calls=0;
const env={
  ADMIN_CENTER:{
    fetch:async request=>{
      calls+=1;
      const url=new URL(request.url);
      assert.equal(url.hostname,"admin.internal");
      assert.equal(url.pathname,"/_internal/ai-gateway-control-readonly-probe");
      assert.equal(request.headers.get("x-three-center-selftest"),"1");
      return Response.json({ok:true,selftest:"admin-ai-gateway-control-direct-read-v2",routes_readable:true,dynamic_route_mutation:false,expert_called:false,secrets_redacted:true});
    }
  }
};

{
  const response=await worker.fetch(new Request("https://governance.test/_internal/ai-gateway-control-readonly-probe"),env,{});
  assert.equal(response.status,404);
  assert.equal(calls,0);
}
{
  const response=await worker.fetch(new Request("https://governance.test/_internal/ai-gateway-control-readonly-probe",{headers:{"x-three-center-selftest":"1"}}),env,{}),body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.ok,true);
  assert.equal(body.binding,true);
  assert.equal(body.service_binding,true);
  assert.equal(body.transport,"service-binding-fetch");
  assert.equal(body.routes_readable,true);
  assert.equal(body.dynamic_route_mutation,false);
  assert.equal(body.expert_called,false);
  assert.equal(body.secrets_redacted,true);
  assert.equal(calls,1);
}

console.log(JSON.stringify({ok:true,suite:"governance-admin-service-binding-ai-gateway-read",named_worker_entrypoint_required:false,default_service_binding:true,routes_list_read_only:true,dynamic_route_mutation:false,secrets_redacted:true}));
