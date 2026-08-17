import assert from "node:assert/strict";
import {triggerCandidateBuilds} from "../src/cloudflare-builds.js";

const COMMITS={governance:"1".repeat(40),intelligence:"2".repeat(40),compute:"3".repeat(40),expert:"4".repeat(40)};
const scripts=[
  ["governance-worker","governance","tag-governance"],
  ["intelligence-worker","intelligence","tag-intelligence"],
  ["compute-worker","compute","tag-compute"],
  ["expert-worker","expert","tag-expert"]
];
const byTag=new Map(scripts.map(([script,center,tag])=>[tag,{script,center}]));
let lock=null;
const state={idFromName:name=>name,get:()=>({fetch:async request=>{
  const path=new URL(request.url).pathname;
  if(request.method==="POST"&&path==="/operation-lock/acquire"){
    const body=await request.json();if(lock)return Response.json({ok:false,error:"ADMIN_OPERATION_BUSY",active:lock},{status:409});lock={owner:body.owner,kind:body.kind};return Response.json({ok:true,active:lock});
  }
  if(request.method==="POST"&&path==="/operation-lock/release"){const body=await request.json();if(!lock)return Response.json({ok:true,released:false});if(body.owner!==lock.owner)return Response.json({ok:false,error:"ADMIN_OPERATION_LOCK_OWNER_MISMATCH"},{status:409});lock=null;return Response.json({ok:true,released:true});}
  if(request.method==="GET"&&path==="/operation-lock")return Response.json({ok:true,active:lock});
  return Response.json({ok:false,error:"UNEXPECTED"},{status:500});
}})};
const env={CLOUDFLARE_ACCOUNT_ID:"account-test",CLOUDFLARE_BUILDS_API_TOKEN:"test-secret",ADMIN_STATE:state};
let scenario="first-existing",created=[],cancelled=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input)),method=String(init.method||"GET").toUpperCase(),prefix="/client/v4/accounts/account-test",path=url.pathname.slice(prefix.length);
  if(method==="GET"&&path==="/workers/scripts")return Response.json({success:true,result:scripts.map(([id,,tag])=>({id,tag}))});
  let m=path.match(/^\/builds\/workers\/([^/]+)\/triggers$/);
  if(method==="GET"&&m){const tag=decodeURIComponent(m[1]);return Response.json({success:true,result:[{trigger_uuid:`preview-${tag}`,deploy_command:"npm run cf:build && npx wrangler versions upload",branch_includes:["*"],branch_excludes:["main"]}]});}
  m=path.match(/^\/builds\/triggers\/preview-(tag-[^/]+)\/builds$/);
  if(method==="POST"&&m){
    const tag=decodeURIComponent(m[1]),{center}=byTag.get(tag),body=JSON.parse(init.body);assert.equal(body.commit_hash,COMMITS[center]);
    if((scenario==="first-existing"&&center==="governance")||(scenario==="second-existing"&&center==="intelligence"))return Response.json({success:true,result:{already_exists:true,build_uuid:`preexisting-${center}`,created_on:"2026-08-16T00:00:00.000Z"}});
    const uuid=`new-${center}`;created.push(uuid);return Response.json({success:true,result:{already_exists:false,build_uuid:uuid,created_on:"2026-08-16T00:00:00.000Z"}});
  }
  m=path.match(/^\/builds\/builds\/([^/]+)\/cancel$/);
  if(method==="PUT"&&m){cancelled.push(decodeURIComponent(m[1]));return Response.json({success:true,result:{build_uuid:decodeURIComponent(m[1]),build_outcome:"cancelled"}});}
  throw new Error(`unexpected ${method} ${path}`);
};

try{
  {
    scenario="first-existing";created=[];cancelled=[];lock=null;
    await assert.rejects(()=>triggerCandidateBuilds(env,{branch:"candidate/already-1",commits:COMMITS}),error=>error?.message==="CANDIDATE_BRANCH_BUILD_ALREADY_PENDING"&&error?.status===409);
    assert.deepEqual(created,[]);assert.deepEqual(cancelled,[]);assert.equal(lock,null);
  }
  {
    scenario="second-existing";created=[];cancelled=[];lock=null;
    await assert.rejects(()=>triggerCandidateBuilds(env,{branch:"candidate/already-2",commits:COMMITS}),error=>error?.message==="CANDIDATE_BRANCH_BUILD_ALREADY_PENDING"&&error?.status===409);
    assert.deepEqual(created,["new-governance"]);
    assert.deepEqual(cancelled,["new-governance"],"only builds created by this request may be cancelled");
    assert.equal(cancelled.includes("preexisting-intelligence"),false);
    assert.equal(lock,null);
  }
  console.log(JSON.stringify({ok:true,suite:"cloudflare-preview-build-guard",already_exists_rejected:true,preexisting_build_never_cancelled:true,partial_new_build_cancelled:true,operation_lock_released:true}));
}finally{globalThis.fetch=originalFetch;}
