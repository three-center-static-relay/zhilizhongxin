import assert from "node:assert/strict";
import {createCandidateVersion} from "../src/admin-gateway.js";

const TOKEN="compensation-test-token";
const COMMITS={governance:"1".repeat(40),intelligence:"2".repeat(40),compute:"3".repeat(40),expert:"4".repeat(40)};
const scripts=[
  ["governance-worker","governance","tag-governance"],
  ["intelligence-worker","intelligence","tag-intelligence"],
  ["compute-worker","compute","tag-compute"],
  ["expert-worker","expert","tag-expert"]
];
const byTag=new Map(scripts.map(([script,center,tag])=>[tag,{script,center}]));

const app={fetch:async request=>{
  const path=new URL(request.url).pathname;
  if(path==="/health")return Response.json({ok:true,status:"ready",service:"governance-worker",api_version:"test"});
  if(path==="/source")return Response.json({ok:true,service:"governance-worker",api_version:"test",source_digest:"d".repeat(64),secrets_redacted:true});
  if(path==="/v1/acceptance/latest")return Response.json({ok:true,status:"not_verified"});
  return Response.json({ok:false,error:"NOT_FOUND"},{status:404});
}};
function center(service,digest,version){return{fetch:async()=>Response.json({ok:true,service,admin_read_only:true,runtime_version:{id:version,tag:null,timestamp:"2026-08-16T00:00:00.000Z"},health:{ok:true,status:"ready",service,api_version:"test"},source:{ok:true,service,api_version:"test",source_digest:digest,secrets_redacted:true},acceptance:{ok:true,status:"not_verified"},active_task:null,active_state_verified:true,secrets_redacted:true})}}
const failingState={idFromName:name=>name,get:()=>({fetch:async request=>{
  assert.equal(new URL(request.url).pathname,"/candidate");
  return Response.json({ok:false,error:"FORCED_ADMIN_STATE_FAILURE"},{status:503});
}})};
const env={
  ADMIN_GPT_TOKEN:TOKEN,
  CLOUDFLARE_ACCOUNT_ID:"account-test",
  CLOUDFLARE_BUILDS_API_TOKEN:"secret-value-must-never-echo",
  CF_VERSION_METADATA:{id:"gov-v1",tag:null,timestamp:"2026-08-16T00:00:00.000Z"},
  INTELLIGENCE_CENTER:center("intelligence-worker","a".repeat(64),"intel-v1"),
  COMPUTE_CENTER:center("compute-worker","b".repeat(64),"compute-v1"),
  EXPERT_CENTER:center("expert-worker","c".repeat(64),"expert-v1"),
  ADMIN_STATE:failingState
};

let buildNumber=0,cancelCount=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async (input,init={})=>{
  const url=new URL(String(input)),method=String(init.method||"GET").toUpperCase();
  const prefix="/client/v4/accounts/account-test",path=url.pathname.slice(prefix.length);
  if(method==="GET"&&path==="/workers/scripts")return Response.json({success:true,result:scripts.map(([id,,tag])=>({id,tag}))});
  let m=path.match(/^\/builds\/workers\/([^/]+)\/triggers$/);
  if(method==="GET"&&m){const tag=decodeURIComponent(m[1]);assert.ok(byTag.has(tag));return Response.json({success:true,result:[{trigger_uuid:`preview-${tag}`,deploy_command:"npx wrangler versions upload",branch_includes:["*"],branch_excludes:["main"]}]});}
  m=path.match(/^\/builds\/triggers\/preview-(tag-[^/]+)\/builds$/);
  if(method==="POST"&&m){const tag=decodeURIComponent(m[1]),entry=byTag.get(tag);assert.ok(entry);const body=JSON.parse(init.body);assert.equal(body.branch,"candidate/persistence-failure");assert.equal(body.commit_hash,COMMITS[entry.center]);buildNumber+=1;return Response.json({success:true,result:{build_uuid:`build-${entry.center}-${buildNumber}`,created_on:"2026-08-16T00:00:00.000Z"}});}
  m=path.match(/^\/builds\/builds\/([^/]+)\/cancel$/);
  if(method==="PUT"&&m){cancelCount+=1;return Response.json({success:true,result:{build_uuid:decodeURIComponent(m[1]),build_outcome:"cancelled"}});}
  throw new Error(`unexpected request ${method} ${path}`);
};

try{
  const request=new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:{authorization:`Bearer ${TOKEN}`,"content-type":"application/json"},body:JSON.stringify({branch:"candidate/persistence-failure",commits:COMMITS})});
  const response=await createCandidateVersion(request,env,{},app),body=await response.json();
  assert.equal(response.status,503);
  assert.equal(body.ok,false);
  assert.equal(body.error,"FORCED_ADMIN_STATE_FAILURE");
  assert.equal(body.builds_triggered,true);
  assert.equal(body.candidate_untracked,true);
  assert.equal(buildNumber,4);
  assert.equal(cancelCount,4);
  assert.equal(body.compensation_cancel.length,4);
  assert.equal(body.compensation_cancel.every(x=>x.cancelled===true),true);
  const raw=JSON.stringify(body);
  assert.equal(raw.includes(env.CLOUDFLARE_BUILDS_API_TOKEN),false);
  assert.equal(raw.includes("authorization"),false);
  console.log(JSON.stringify({ok:true,suite:"governance-admin-candidate-compensation",builds_triggered:4,compensation_cancelled:4,secret_echo:false}));
}finally{globalThis.fetch=originalFetch;}
