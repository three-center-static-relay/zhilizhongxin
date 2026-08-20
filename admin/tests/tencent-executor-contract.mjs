import assert from "node:assert/strict";
import {tencentExecutorStatus,tencentExecutorSelftest,tencentAgentInvoke} from "../src/tencent-executor.js";

const originalFetch=globalThis.fetch;
const sse=(event,payload)=>`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
const jsonResponse=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}});
const header=(init,name)=>new Headers(init?.headers||{}).get(name);

async function readJson(response){return await response.json()}

try{
  {
    let calls=0;
    globalThis.fetch=async()=>{calls++;throw new Error("fetch should not run")};
    const env={
      TENCENT_MAKERS_EXECUTOR_MODE:"project-domain",
      TENCENT_MAKERS_EXECUTOR_URL:"https://fixed-project.edgeone.app",
      TENCENT_EXECUTOR_SHARED_TOKEN:"executor-only"
    };
    const response=await tencentExecutorStatus(env),body=await readJson(response);
    assert.equal(response.status,200);
    assert.equal(body.ok,true);
    assert.equal(body.resolved_executor.mode,"project-domain");
    assert.equal(body.resolved_executor.source,"cloudflare-config");
    assert.equal(body.resolved_executor.host,"fixed-project.edgeone.app");
    assert.equal(calls,0);
  }

  {
    let calls=0;
    globalThis.fetch=async()=>{calls++;throw new Error("fetch should not run without management token")};
    const env={
      TENCENT_MAKERS_EXECUTOR_MODE:"bootstrap-deployment",
      TENCENT_MAKERS_PROJECT_NAME:"contract-missing-token",
      TENCENT_EXECUTOR_SHARED_TOKEN:"executor-only"
    };
    const response=await tencentExecutorStatus(env),body=await readJson(response);
    assert.equal(response.status,503);
    assert.equal(body.ok,false);
    assert.equal(body.stable_domain_configured,false);
    assert.equal(body.discovery_error,"TENCENT_MAKERS_API_TOKEN_NOT_CONFIGURED");
    assert.equal(calls,0);
  }

  {
    const env={
      TENCENT_MAKERS_EXECUTOR_MODE:"bootstrap-deployment",
      TENCENT_MAKERS_PROJECT_NAME:"contract-active-custom",
      TENCENT_MAKERS_API_TOKEN:"management-only-custom",
      TENCENT_EXECUTOR_SHARED_TOKEN:"executor-only-custom"
    };
    globalThis.fetch=async(input,init={})=>{
      const url=String(input);
      assert.ok(url.startsWith("https://pages-api."));
      assert.equal(header(init,"authorization"),"Bearer management-only-custom");
      assert.equal(header(init,"x-executor-token"),null);
      return jsonResponse({Code:0,Data:{Response:{Projects:[{
        ProjectId:"p-custom",Name:"contract-active-custom",Status:"Active",
        PresetDomain:"preset.edgeone.app",
        CustomDomains:[{Status:"Active",Domain:"executor.example.com"}]
      }]}}});
    };
    const response=await tencentExecutorStatus(env),body=await readJson(response);
    assert.equal(response.status,200);
    assert.equal(body.resolved_executor.mode,"custom-domain");
    assert.equal(body.resolved_executor.host,"executor.example.com");
    assert.equal(body.resolved_executor.source,"makers-management-api");
  }

  {
    const probe="a".repeat(64),expectedCid=`selftest_${"a".repeat(24)}`;
    const env={
      TENCENT_MAKERS_EXECUTOR_MODE:"bootstrap-deployment",
      TENCENT_MAKERS_PROJECT_NAME:"contract-runtime-e2e",
      TENCENT_MAKERS_API_TOKEN:"management-secret",
      TENCENT_EXECUTOR_SHARED_TOKEN:"executor-secret",
      TENCENT_DEPLOY_E2E_PROBE:probe
    };
    const seen=[];
    globalThis.fetch=async(input,init={})=>{
      const url=String(input),headers=new Headers(init.headers||{});
      seen.push({url,authorization:headers.get("authorization"),executor:headers.get("x-executor-token"),conversation:headers.get("makers-conversation-id")});
      if(url.startsWith("https://pages-api.")){
        assert.equal(headers.get("authorization"),"Bearer management-secret");
        assert.equal(headers.get("x-executor-token"),null);
        return jsonResponse({Code:0,Data:{Response:{Projects:[{
          ProjectId:"p-runtime",Name:"contract-runtime-e2e",Status:"Active",
          PresetDomain:"runtime-stable.edgeone.app",CustomDomains:[]
        }]}}});
      }
      if(url==="https://runtime-stable.edgeone.app/health"){
        assert.equal(headers.get("authorization"),null);
        assert.equal(headers.get("x-executor-token"),null);
        return jsonResponse({ok:true,language:"python",python_version:"3.11"});
      }
      if(url==="https://runtime-stable.edgeone.app/capabilities"){
        assert.equal(headers.get("authorization"),null);
        assert.equal(headers.get("x-executor-token"),"executor-secret");
        assert.equal(headers.get("makers-conversation-id"),expectedCid);
        return new Response(sse("capabilities",{ok:true,tool_count:4,families:{commands:true,files:true,code:true,browser:true}}),{status:200,headers:{"content-type":"text/event-stream"}});
      }
      if(url==="https://runtime-stable.edgeone.app/runtime-selftest"){
        assert.equal(headers.get("authorization"),null);
        assert.equal(headers.get("x-executor-token"),"executor-secret");
        assert.equal(headers.get("makers-conversation-id"),expectedCid);
        return new Response(sse("selftest",{validation:"PASS",checks:[
          {name:"shell",ok:true,observed:"EDGEONE_SHELL_OK"},
          {name:"files",ok:true,observed:"write-read-delete"},
          {name:"code_interpreter",ok:true,observed:4181},
          {name:"browser",ok:true,observed:{title:"Example Domain",url:"https://example.com/"}}
        ],sandbox_cleanup:{attempted:true,ok:true}}),{status:200,headers:{"content-type":"text/event-stream"}});
      }
      if(url==="https://runtime-stable.edgeone.app/chat"){
        assert.equal(headers.get("authorization"),null);
        assert.equal(headers.get("x-executor-token"),"executor-secret");
        return new Response(sse("text_delta",{text:"OK"}),{status:200,headers:{"content-type":"text/event-stream","set-cookie":"must-be-removed"}});
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const selftestResponse=await tencentExecutorSelftest(env),selftest=await readJson(selftestResponse);
    assert.equal(selftestResponse.status,200);
    assert.equal(selftest.ok,true);
    assert.equal(selftest.validation,"PASS");
    assert.equal(selftest.selftest,"executor-runtime-v5");
    assert.equal(selftest.conversation_id,expectedCid);
    assert.equal(selftest.conversation_reused_for_deploy_probe,true);
    assert.equal(selftest.resolved_executor.mode,"project-domain");
    assert.equal(selftest.resolved_executor.host,"runtime-stable.edgeone.app");
    assert.equal(selftest.checks.length,15);
    assert.equal(selftest.checks.every(check=>check.ok===true),true);

    const agentResponse=await tencentAgentInvoke(new Request("https://admin.invalid/v1/admin/tencent/agent",{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"contract ping",conversation_id:"contract_123"})
    }),env);
    assert.equal(agentResponse.status,200);
    assert.equal(agentResponse.headers.get("x-tencent-executor-domain-kind"),"project-domain");
    assert.equal(agentResponse.headers.get("set-cookie"),null);

    const managementCalls=seen.filter(x=>x.url.startsWith("https://pages-api."));
    const executionCalls=seen.filter(x=>x.url.startsWith("https://runtime-stable.edgeone.app/"));
    const selftestCalls=executionCalls.filter(x=>x.url.endsWith("/capabilities")||x.url.endsWith("/runtime-selftest"));
    assert.ok(managementCalls.length>=1);
    assert.ok(executionCalls.length>=4);
    assert.equal(managementCalls.every(x=>x.authorization==="Bearer management-secret"&&x.executor===null),true);
    assert.equal(executionCalls.every(x=>x.authorization===null),true);
    assert.equal(executionCalls.filter(x=>!x.url.endsWith("/health")).every(x=>x.executor==="executor-secret"),true);
    assert.equal(selftestCalls.length,2);
    assert.equal(selftestCalls.every(x=>x.conversation===expectedCid),true);
  }

  console.log("TENCENT_EXECUTOR_CONTRACT_PASS");
}finally{
  globalThis.fetch=originalFetch;
}
