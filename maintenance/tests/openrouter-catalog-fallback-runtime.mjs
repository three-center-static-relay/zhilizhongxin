import assert from "node:assert/strict";
import {discoverOpenRouter} from "../src/model-universe.js";

const calls=[];
const catalog={data:[
  {id:"vendor-a/model-current",architecture:{output_modalities:["text"]},pricing:{prompt:"0.000001",completion:"0.000002"},supported_parameters:["reasoning","max_tokens"],context_length:131072},
  {id:"vendor-b/model-next-flash",architecture:{output_modalities:["text"]},pricing:{prompt:"0",completion:"0"},supported_parameters:["max_tokens"],context_length:262144}
]};
const fetchMock=async(url,init={})=>{
  calls.push({url:String(url),headers:init.headers||{}});
  if(String(url)==="https://openrouter.ai/api/v1/models")return new Response(JSON.stringify({error:"authentication required"}),{status:401,headers:{"content-type":"application/json"}});
  if(String(url).includes("gateway.ai.cloudflare.com")&&String(url).endsWith("/openrouter/models")){
    assert.equal(init.headers?.["cf-aig-authorization"],"Bearer gateway-run-token");
    assert.equal(init.headers?.["cf-aig-collect-log-payload"],"false");
    assert.equal(init.headers?.authorization,undefined,"BYOK fallback must not expose or require the provider key in Worker code");
    return new Response(JSON.stringify(catalog),{status:200,headers:{"content-type":"application/json"}});
  }
  return new Response(JSON.stringify({error:"unexpected"}),{status:404,headers:{"content-type":"application/json"}});
};
const rows=await discoverOpenRouter({CF_ACCOUNT_ID:"account",AI_GATEWAY_ID:"test",AI_GATEWAY_TOKEN:"gateway-run-token"},fetchMock);
assert.equal(rows.length,2);
assert.deepEqual(new Set(rows.map(x=>x.company)),new Set(["vendor-a","vendor-b"]));
assert.equal(rows.every(x=>x.meta?.catalog_transport==="cloudflare-ai-gateway-byok"),true);
assert.equal(rows.some(x=>x.model.includes("flash")),true,"model suffixes are catalog data and must not be architecture filters");
assert.equal(rows.some(x=>x.free===true),true);
assert.equal(calls[0].url,"https://openrouter.ai/api/v1/models");
assert.equal(calls[1].url,"https://gateway.ai.cloudflare.com/v1/account/test/openrouter/models");
console.log(JSON.stringify({ok:true,suite:"openrouter-catalog-fallback-runtime",direct_auth_failure_recovered:true,gateway_byok_fallback:true,provider_key_in_worker:false,model_suffix_filtering:false,secrets_redacted:true}));
