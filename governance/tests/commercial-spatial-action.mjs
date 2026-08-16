import assert from "node:assert/strict";
import worker from "../src/admin-entry.js";

const calls=[];
const env={
  ADMIN_GPT_TOKEN:"TEST_ADMIN_TOKEN",
  COMPUTE_CENTER:{fetch:async req=>{
    const url=new URL(req.url),body=await req.json();calls.push({url:url.toString(),body});
    if(url.pathname==="/v1/run")return Response.json({ok:true,task_id:body.task_id,status:"running",executor:"kaggle-official",machine_shape:"cpu"},{status:202});
    if(url.pathname==="/v1/status")return Response.json({ok:true,task_id:body.task_id,status:"completed",result:{ok:true,recipe:"commercial_spatial_fusion",observed_lbs:false,real_footfall:false,network_used:false,commercial_location_score:55.0}},{status:200});
    return Response.json({ok:false,error:"UNEXPECTED_PATH"},{status:404});
  }}
};
const headers={authorization:"Bearer TEST_ADMIN_TOKEN","content-type":"application/json"};
const D=x=>x.repeat(64);
const valid={task_id:"powerlong-fuzhou-contract",source_receipts:[{source:"worldpop",result_digest:D("a")},{source:"baidu_traffic",digest_sha256:D("b")},{source:"tencent_maps_poi",result_digest:D("c")},{source:"amap_routing",result_digest:D("d")}],rings:[{radius_m:1000,population:97384.79,area_km2:3.093,working_age_share:72.2,poi_total:240,competitor_count:3,transit_count:5,nearest_transit_walk_min:6.1,traffic_status:2},{radius_m:3000,population:640288.44,area_km2:27.837,working_age_share:0.722,poi_total:950,competitor_count:12,transit_count:20,nearest_transit_walk_min:6.1,traffic_status:2}]};

let r=await worker.fetch(new Request("https://governance-worker.example/v1/compute/commercial-spatial",{method:"POST",headers,body:JSON.stringify(valid)}),env,{});
assert.equal(r.status,202);let j=await r.json();assert.equal(j.ok,true);assert.equal(j.task_id,"powerlong-fuzhou-contract");
assert.equal(calls.length,1);const dispatched=calls[0];assert.equal(dispatched.url,"https://compute.internal/v1/run");assert.equal(dispatched.body.profile,"gis");assert.equal(dispatched.body.provider,"kaggle");assert.equal(dispatched.body.gpu,false);assert.equal(dispatched.body.timeout_seconds,300);assert.deepEqual(Object.keys(dispatched.body.input),["model_recipe"]);assert.equal(dispatched.body.input.model_recipe.model_id,"location_intelligence.commercial_spatial_fusion");assert.equal(dispatched.body.input.model_recipe.args.rings[0].working_age_share,0.722);assert.equal(dispatched.body.input.model_recipe.args.source_receipts[0].digest_sha256,D("a"));

r=await worker.fetch(new Request("https://governance-worker.example/v1/compute/commercial-spatial/status",{method:"POST",headers,body:JSON.stringify({task_id:"powerlong-fuzhou-contract"})}),env,{});assert.equal(r.status,200);j=await r.json();assert.equal(j.status,"completed");assert.equal(j.result.observed_lbs,false);assert.equal(j.result.real_footfall,false);assert.equal(j.result.network_used,false);assert.equal(calls[1].url,"https://compute.internal/v1/status");assert.deepEqual(calls[1].body,{task_id:"powerlong-fuzhou-contract"});

const before=calls.length;r=await worker.fetch(new Request("https://governance-worker.example/v1/compute/commercial-spatial",{method:"POST",headers,body:JSON.stringify({...valid,provider:"other"})}),env,{});assert.equal(r.status,400);assert.equal(calls.length,before,"unknown top-level controls must be rejected before compute binding");
r=await worker.fetch(new Request("https://governance-worker.example/v1/compute/commercial-spatial",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(valid)}),env,{});assert.equal(r.status,401);assert.equal(calls.length,before);
r=await worker.fetch(new Request("https://governance-worker.example/v1/compute/commercial-spatial",{method:"POST",headers,body:JSON.stringify({...valid,source_receipts:[{source:"worldpop",result_digest:D("a")} ]})}),env,{});assert.equal(r.status,400);assert.equal(calls.length,before);

console.log(JSON.stringify({ok:true,suite:"commercial-spatial-governance-action",fixed_model:true,fixed_provider:"kaggle",fixed_profile:"gis",gpu:false,network_control_exposed:false,arbitrary_code_exposed:false,source_receipts_required:true,status_route:true}));
