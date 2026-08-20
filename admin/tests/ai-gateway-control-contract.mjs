import assert from "node:assert/strict";
import fs from "node:fs";
import {aiGatewayControlRequest,operationRequest} from "../src/ai-gateway-control.js";

const env={CF_ACCOUNT_ID:"acct",CF_API_TOKEN:"secret-token",AI_GATEWAY_ID:"test"};
assert.equal(operationRequest(env,{operation:"routes.list"}).path,"/routes?per_page=100");
assert.equal(operationRequest(env,{operation:"logs.list",page:99,per_page:999}).path,"/logs?per_page=50&page=4&order_by=created_at&order_by_direction=desc");
assert.throws(()=>operationRequest(env,{operation:"routes.create",name:"other-v1",elements:[{id:"x"}]}),/AI_GATEWAY_CONTROL_ROUTE_NAME_DENIED/);
assert.throws(()=>operationRequest(env,{operation:"routes.list",gateway_id:"other"}),/AI_GATEWAY_CONTROL_GATEWAY_MISMATCH/);
assert.throws(()=>operationRequest(env,{operation:"routes.delete",route_id:"x"}),/AI_GATEWAY_CONTROL_OPERATION_DENIED/);

const tencentList=operationRequest(env,{operation:"custom-providers.tencent-tokenhub.list"});
assert.equal(tencentList.scope,"account");
assert.equal(tencentList.path,"/custom-providers?search=tencent-tokenhub");
const tencentCreate=operationRequest(env,{operation:"custom-providers.tencent-tokenhub.create"});
assert.equal(tencentCreate.scope,"account");
assert.equal(tencentCreate.method,"POST");
assert.equal(tencentCreate.path,"/custom-providers");
assert.deepEqual(tencentCreate.body,{
  name:"Tencent TokenHub",
  slug:"tencent-tokenhub",
  base_url:"https://tokenhub.tencentmaas.com",
  description:"Tencent Cloud TokenHub Guangzhou / China mainland OpenAI-compatible provider",
  link:"https://cloud.tencent.com/document/product/1823/130078",
  enable:false
});
assert.ok(!JSON.stringify(tencentCreate.body).match(/api[_-]?key|secret/i));
const tencentEnable=operationRequest(env,{operation:"custom-providers.tencent-tokenhub.enable",provider_id:"provider_1"});
assert.deepEqual(tencentEnable.body,{enable:true});
const tencentDisable=operationRequest(env,{operation:"custom-providers.tencent-tokenhub.disable",provider_id:"provider_1"});
assert.deepEqual(tencentDisable.body,{enable:false});

let captured;
const fakeFetch=async(url,init)=>{captured={url,init};return{ok:true,status:200,json:async()=>({success:true,result:{ok:true}})}};
const result=await aiGatewayControlRequest(env,{operation:"deployments.create",route_id:"route_1",version_id:"v_1"},fakeFetch);
assert.equal(result.success,true);
assert.match(captured.url,/\/ai-gateway\/gateways\/test\/routes\/route_1\/deployments$/);
assert.equal(captured.init.method,"POST");
assert.equal(captured.init.headers.authorization,"Bearer secret-token");
assert.ok(!JSON.stringify(result).includes("secret-token"));

await aiGatewayControlRequest(env,{operation:"custom-providers.tencent-tokenhub.create"},fakeFetch);
assert.match(captured.url,/\/ai-gateway\/custom-providers$/);
assert.doesNotMatch(captured.url,/\/gateways\/test\/custom-providers/);
assert.equal(captured.init.method,"POST");
assert.equal(JSON.parse(captured.init.body).slug,"tencent-tokenhub");
assert.equal(JSON.parse(captured.init.body).enable,false);

const production=fs.readFileSync(new URL("../src/production-entry.js",import.meta.url),"utf8");
const configText=fs.readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");
assert.match(configText,/\{\s*"binding"\s*:\s*"AI_GATEWAY_CREDENTIAL_READ"\s*,\s*"service"\s*:\s*"maintenance-worker"\s*,\s*"entrypoint"\s*:\s*"AIGatewayCredentialRead"\s*\}/s);
assert.match(production,/operationRequest\(this\.env,input\|\|\{\}\)/);
assert.match(production,/AI_GATEWAY_CREDENTIAL_READ\.request\(\{operation:"routes\.list"\}\)/);
assert.match(production,/admin-maintenance-ai-gateway-credential-read-v1/);
assert.match(production,/credential_source:"maintenance-worker"/);
assert.match(production,/dynamic_route_mutation:false/);
assert.match(production,/secrets_redacted:true/);
console.log(JSON.stringify({ok:true,suite:"ai-gateway-control-broker",named_entrypoint_only:true,operation_whitelist:true,read_delegated_to_credential_custodian:true,credential_custodian:"maintenance-worker",control_plane_owner:"admin-worker",no_delete:true,no_token_return:true,jsonc_comments_supported:true,tencent_tokenhub_custom_provider_candidate:true,tencent_provider_default_disabled:true}));
