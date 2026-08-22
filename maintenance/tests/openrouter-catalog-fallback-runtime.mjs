import assert from "node:assert/strict";
import {discoverOpenRouter} from "../src/model-universe.js";

const catalog={data:[
  {id:"vendor-a/model-current",architecture:{output_modalities:["text"]},pricing:{prompt:"0.000001",completion:"0.000002"},supported_parameters:["reasoning","max_tokens"],context_length:131072},
  {id:"vendor-b/model-next-flash",architecture:{output_modalities:["text"]},pricing:{prompt:"0",completion:"0"},supported_parameters:["max_tokens"],context_length:262144}
]};

const gatewayCalls=[];
const gatewayFirstFetch=async(url,init={})=>{
  gatewayCalls.push({url:String(url),headers:init.headers||{}});
  if(String(url).includes("gateway.ai.cloudflare.com")&&String(url).endsWith("/openrouter/models")){
    assert.equal(init.headers?.["cf-aig-authorization"],"Bearer gateway-run-token");
    assert.equal(init.headers?.["cf-aig-collect-log-payload"],"false");
    assert.equal(init.headers?.authorization,undefined,"Gateway BYOK discovery must not expose or require the provider key in Worker code");
    return new Response(JSON.stringify(catalog),{status:200,headers:{"content-type":"application/json"}});
  }
  if(String(url)==="https://openrouter.ai/api/v1/models")throw new Error("direct catalog must not be called when Gateway succeeds");
  return new Response(JSON.stringify({error:"unexpected"}),{status:404,headers:{"content-type":"application/json"}});
};
const gatewayRows=await discoverOpenRouter({CF_ACCOUNT_ID:"account",AI_GATEWAY_ID:"test",AI_GATEWAY_TOKEN:"gateway-run-token"},gatewayFirstFetch);
assert.equal(gatewayRows.length,2);
assert.deepEqual(new Set(gatewayRows.map(x=>x.company)),new Set(["vendor-a","vendor-b"]));
assert.equal(gatewayRows.every(x=>x.meta?.catalog_transport==="cloudflare-ai-gateway-byok"),true);
assert.equal(gatewayRows.some(x=>x.model.includes("flash")),true,"model suffixes are catalog data and must not be architecture filters");
assert.equal(gatewayRows.some(x=>x.free===true),true);
assert.equal(gatewayCalls.length,1);
assert.equal(gatewayCalls[0].url,"https://gateway.ai.cloudflare.com/v1/account/test/openrouter/models");

const fallbackCalls=[];
const directFallbackFetch=async(url,init={})=>{
  fallbackCalls.push({url:String(url),headers:init.headers||{}});
  if(String(url).includes("gateway.ai.cloudflare.com"))return new Response(JSON.stringify({error:"gateway unavailable"}),{status:502,headers:{"content-type":"application/json"}});
  if(String(url)==="https://openrouter.ai/api/v1/models")return new Response(JSON.stringify(catalog),{status:200,headers:{"content-type":"application/json"}});
  return new Response(JSON.stringify({error:"unexpected"}),{status:404,headers:{"content-type":"application/json"}});
};
const fallbackRows=await discoverOpenRouter({CF_ACCOUNT_ID:"account",AI_GATEWAY_ID:"test",AI_GATEWAY_TOKEN:"gateway-run-token"},directFallbackFetch);
assert.equal(fallbackRows.length,2);
assert.equal(fallbackRows.every(x=>x.meta?.catalog_transport==="openrouter-direct-fallback"),true);
assert.equal(fallbackCalls[0].url,"https://gateway.ai.cloudflare.com/v1/account/test/openrouter/models");
assert.equal(fallbackCalls[1].url,"https://gateway.ai.cloudflare.com/v1/account/test/openrouter/v1/models");
assert.equal(fallbackCalls[2].url,"https://openrouter.ai/api/v1/models");

console.log(JSON.stringify({ok:true,suite:"openrouter-catalog-fallback-runtime",gateway_primary:true,direct_catalog_fallback:true,gateway_byok:true,provider_key_in_worker:false,model_suffix_filtering:false,secrets_redacted:true}));
