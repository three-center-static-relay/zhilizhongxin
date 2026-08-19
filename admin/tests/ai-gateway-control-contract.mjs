import assert from "node:assert/strict";
import {aiGatewayControlRequest,operationRequest} from "../src/ai-gateway-control.js";

const env={CF_ACCOUNT_ID:"acct",CF_API_TOKEN:"secret-token",AI_GATEWAY_ID:"test"};
assert.equal(operationRequest(env,{operation:"routes.list"}).path,"/routes?per_page=100");
assert.equal(operationRequest(env,{operation:"logs.list",page:99,per_page:999}).path,"/logs?per_page=50&page=4&order_by=created_at&order_by_direction=desc");
assert.throws(()=>operationRequest(env,{operation:"routes.create",name:"other-v1",elements:[{id:"x"}]}),/AI_GATEWAY_CONTROL_ROUTE_NAME_DENIED/);
assert.throws(()=>operationRequest(env,{operation:"routes.list",gateway_id:"other"}),/AI_GATEWAY_CONTROL_GATEWAY_MISMATCH/);
assert.throws(()=>operationRequest(env,{operation:"routes.delete",route_id:"x"}),/AI_GATEWAY_CONTROL_OPERATION_DENIED/);
let captured;
const fakeFetch=async(url,init)=>{captured={url,init};return{ok:true,status:200,json:async()=>({success:true,result:{ok:true}})}};
const result=await aiGatewayControlRequest(env,{operation:"deployments.create",route_id:"route_1",version_id:"v_1"},fakeFetch);
assert.equal(result.success,true);
assert.match(captured.url,/\/ai-gateway\/gateways\/test\/routes\/route_1\/deployments$/);
assert.equal(captured.init.method,"POST");
assert.equal(captured.init.headers.authorization,"Bearer secret-token");
assert.ok(!JSON.stringify(result).includes("secret-token"));
console.log(JSON.stringify({ok:true,suite:"ai-gateway-control-broker",named_entrypoint_only:true,operation_whitelist:true,no_delete:true,no_token_return:true}));
