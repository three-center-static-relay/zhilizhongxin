import assert from "node:assert/strict";
import worker,{AdminState} from "../src/admin-entry.js";

const TOKEN="phase2-admin-token";
let downstreamCalls=0;
const versions={intelligence:"intel-v1",compute:"compute-v1",expert:"expert-v1"};
const active={intelligence:null,compute:null,expert:null};
function center(name,service,digest){
  return {
    fetch:async request=>{
      downstreamCalls+=1;
      assert.equal(new URL(request.url).pathname,"/v1/admin/context");
      return Response.json({
        ok:true,service,admin_read_only:true,observed_at:"2026-08-16T00:00:00.000Z",
        runtime_version:{id:versions[name],tag:null,timestamp:"2026-08-16T00:00:00.000Z"},
        health:{ok:true,status:"ready",service,api_version:"test"},
        source:{ok:true,service,api_version:"test",source_digest:digest,secrets_redacted:true},
        acceptance:{ok:true,status:"not_verified"},active_task:active[name],active_state_verified:true,secrets_redacted:true
      });
    }
  };
}

class MemoryStorage{
  constructor(){this.map=new Map()}
  async get(key){return this.map.get(key)}
  async put(key,value){this.map.set(key,structuredClone(value))}
  async delete(key){this.map.delete(key)}
}
const storage=new MemoryStorage();
const stateObject=new AdminState({storage},{});
let stateCalls=0;
const stateBinding={
  idFromName:name=>name,
  get:()=>({fetch:async request=>{stateCalls+=1;return stateObject.fetch(request)}})
};
const env={
  ADMIN_GPT_TOKEN:TOKEN,
  CF_VERSION_METADATA:{id:"gov-v1",tag:null,timestamp:"2026-08-16T00:00:00.000Z"},
  INTELLIGENCE_CENTER:center("intelligence","intelligence-worker","a".repeat(64)),
  COMPUTE_CENTER:center("compute","compute-worker","b".repeat(64)),
  EXPERT_CENTER:center("expert","expert-worker","c".repeat(64)),
  ADMIN_STATE:stateBinding
};
const auth={authorization:`Bearer ${TOKEN}`,"content-type":"application/json"};

// Wrong auth is rejected before downstream reads or Durable Object state access.
{
  downstreamCalls=0;stateCalls=0;
  const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:{authorization:"Bearer wrong","content-type":"application/json"},body:"{}"}),env,{});
  assert.equal(response.status,401);
  assert.equal(downstreamCalls,0);
  assert.equal(stateCalls,0);
}

// Unknown fields are rejected and do not create candidate state.
{
  stateCalls=0;
  const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:JSON.stringify({label:"x",promote:true})}),env,{});
  assert.equal(response.status,400);
  assert.equal(stateCalls,0);
}

// Create immutable production-runtime snapshot candidate.
let candidateId,candidateDigest;
{
  const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:JSON.stringify({label:"phase-2",reason:"control-plane acceptance only"})}),env,{});
  const body=await response.json();
  assert.equal(response.status,201);
  assert.equal(body.ok,true);
  assert.equal(body.operation,"createCandidateVersion");
  assert.equal(body.receipt_schema,"three-center-admin-candidate-receipt-v1");
  assert.equal(body.production_write,false);
  assert.equal(body.admin_metadata_write,true);
  assert.equal(body.data.candidate_kind,"production-runtime-snapshot");
  assert.equal(body.data.fresh_business_e2e,false);
  assert.equal(body.data.promotion_eligible,false);
  assert.match(body.receipt_digest,/^[a-f0-9]{64}$/);
  assert.match(body.candidate_digest,/^[a-f0-9]{64}$/);
  candidateId=body.tested_candidate;candidateDigest=body.candidate_digest;
  assert.match(candidateId,/^candidate-/);
}

// Same runtime snapshot validates at control-plane scope only.
let acceptanceRunId,acceptanceDigest;
{
  const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates/validate",{method:"POST",headers:auth,body:JSON.stringify({candidate_id:candidateId})}),env,{});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.ok,true);
  assert.equal(body.validation,"PASS");
  assert.equal(body.acceptance_scope,"control-plane-consistency-v1");
  assert.equal(body.fresh_business_e2e,false);
  assert.equal(body.promotion_eligible,false);
  assert.equal(body.promotion_block_reason,"phase-2-control-plane-only");
  assert.equal(body.candidate_digest,candidateDigest);
  assert.equal(body.checks.length,8);
  assert.equal(body.checks.every(x=>x.ok===true),true);
  assert.match(body.receipt_digest,/^[a-f0-9]{64}$/);
  acceptanceRunId=body.run_id;acceptanceDigest=body.receipt_digest;
}

// Acceptance can be queried by run_id and preserves the stored immutable receipt digest.
{
  const response=await worker.fetch(new Request(`https://governance.test/v1/admin/acceptance?run_id=${encodeURIComponent(acceptanceRunId)}`,{headers:{authorization:`Bearer ${TOKEN}`}}),env,{});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.operation,"getAcceptanceResult");
  assert.equal(body.data.query_run_id,acceptanceRunId);
  assert.equal(body.data.acceptance_receipt_digest,acceptanceDigest);
  assert.equal(body.data.acceptance.receipt_digest,acceptanceDigest);
  assert.equal(body.data.acceptance.validation,"PASS");
  assert.match(body.receipt_digest,/^[a-f0-9]{64}$/);
}

// Version drift after snapshot is a stored FAIL receipt, never a PASS.
let driftCandidateId,driftRunId;
{
  const create=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:"{}"}),env,{});
  const created=await create.json();driftCandidateId=created.tested_candidate;
  versions.compute="compute-v2";
  const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates/validate",{method:"POST",headers:auth,body:JSON.stringify({candidate_id:driftCandidateId})}),env,{});
  const body=await response.json();
  assert.equal(response.status,422);
  assert.equal(body.ok,false);
  assert.equal(body.validation,"FAIL");
  assert.equal(body.fresh_business_e2e,false);
  assert.equal(body.promotion_eligible,false);
  assert.equal(body.checks.find(x=>x.name==="runtime_version_identity")?.ok,false);
  driftRunId=body.run_id;
  const query=await worker.fetch(new Request(`https://governance.test/v1/admin/acceptance?run_id=${encodeURIComponent(driftRunId)}`,{headers:{authorization:`Bearer ${TOKEN}`}}),env,{});
  const queried=await query.json();
  assert.equal(query.status,200);
  assert.equal(queried.data.acceptance.validation,"FAIL");
  versions.compute="compute-v1";
}

// Active downstream work blocks creation of a supposedly stable candidate snapshot.
{
  active.expert={task_id:"busy-expert",kind:"expert"};
  const response=await worker.fetch(new Request("https://governance.test/v1/admin/candidates",{method:"POST",headers:auth,body:"{}"}),env,{});
  const body=await response.json();
  assert.equal(response.status,409);
  assert.equal(body.error,"ADMIN_BUSY");
  assert.equal(body.active_tasks.expert.task_id,"busy-expert");
  active.expert=null;
}

// Phase 2 Action surface has candidate+acceptance metadata only; promote/rollback remain absent.
{
  const response=await worker.fetch(new Request("https://governance.test/openapi.json"),env,{});
  const spec=await response.json(),operationIds=[];
  for(const pathItem of Object.values(spec.paths))for(const operation of Object.values(pathItem))operationIds.push(operation.operationId);
  for(const required of ["createCandidateVersion","validateCandidate","getAcceptanceResult"])assert.ok(operationIds.includes(required));
  for(const forbidden of ["promoteCandidate","rollbackProduction"])assert.equal(operationIds.includes(forbidden),false);
  assert.equal(operationIds.length,10);
}

console.log(JSON.stringify({ok:true,suite:"governance-admin-candidate-acceptance",candidate_kind:"production-runtime-snapshot",acceptance_scope:"control-plane-consistency-v1",fresh_business_e2e:false,promotion_enabled:false,rollback_enabled:false,total_action_operations:10}));
