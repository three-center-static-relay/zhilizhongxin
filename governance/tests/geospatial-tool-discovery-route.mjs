import assert from "node:assert/strict";
import worker from "../src/admin-entry.js";

const calls=[];
const INTELLIGENCE_CENTER={fetch:async request=>{
  const body=await request.json();calls.push(body);
  assert.match(body.task_id,/^professional-web-/);assert.equal(body.timeout_seconds,60);
  if(body.provider==="exa")return Response.json({ok:true,result_digest:"a".repeat(64),result:{items:[{title:"Official A",url:"https://official.example/a",highlights:["exa evidence"]},{title:"Duplicate",url:"https://official.example/shared",highlights:["shared"]}]}});
  if(body.provider==="tavily")return Response.json({ok:true,result_digest:"b".repeat(64),result:{items:[{title:"Official B",url:"https://official.example/b",content:"tavily evidence"},{title:"Duplicate 2",url:"https://official.example/shared",content:"shared second"}]}});
  if(body.provider==="firecrawl")return Response.json({ok:true,result_digest:"c".repeat(64),result:{items:[{title:"Official C",url:"https://official.example/c",description:"firecrawl evidence"}]}});
  if(body.provider==="jina")return Response.json({ok:true,result_digest:"d".repeat(64),result:{url:body.args.url,content:"grounded page content"}});
  return Response.json({ok:false,error:"unexpected"},{status:500});
}};
const env={ADMIN_GPT_TOKEN:"controller-secret",INTELLIGENCE_CENTER};
const headers={authorization:"Bearer controller-secret","content-type":"application/json"};
const r=await worker.fetch(new Request("https://governance-worker.example/v1/intelligence/geospatial-tool-discovery",{method:"POST",headers,body:JSON.stringify({queries:["free China commercial geospatial API"],limit_per_provider:4,deep_read_count:2})}),env,{}),b=await r.json();
assert.equal(r.status,200);assert.equal(b.ok,true);assert.equal(b.suite,"professional-web-intelligence-geospatial-discovery");assert.equal(b.discovery_only,true);assert.equal(b.production_dependency,false);assert.equal(b.production_feature_source,false);assert.equal(b.auto_install,false);assert.equal(b.auto_writeback,false);assert.equal(b.requires_independent_validation,true);assert.deepEqual(b.providers,["exa","tavily","firecrawl","jina"]);assert.equal(b.queries.length,1);assert.equal(b.attempts.length,5);assert.equal(b.candidate_count,4);assert.equal(b.deep_reads.length,2);assert.ok(b.attempts.every(x=>x.ok===true));assert.equal(calls.filter(x=>["exa","tavily","firecrawl"].includes(x.provider)).length,3);assert.equal(calls.filter(x=>x.provider==="jina").length,2);assert.equal(new Set(calls.map(x=>x.task_id)).size,calls.length);assert.equal(calls[0].operation,"search");assert.equal(calls.at(-1).operation,"read");assert.equal(calls[0].args.limit,4);
const denied=await worker.fetch(new Request("https://governance-worker.example/v1/intelligence/geospatial-tool-discovery",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}),env,{});assert.equal(denied.status,401);
const invalid=await worker.fetch(new Request("https://governance-worker.example/v1/intelligence/geospatial-tool-discovery",{method:"POST",headers,body:JSON.stringify({provider:"exa"})}),env,{});assert.equal(invalid.status,400);
console.log(JSON.stringify({ok:true,suite:"geospatial-tool-discovery-route",providers:["exa","tavily","firecrawl","jina"],sequential_bounded:true,deduplicated:true,auto_install:false,auto_writeback:false}));
