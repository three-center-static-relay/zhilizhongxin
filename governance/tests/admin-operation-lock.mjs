import assert from "node:assert/strict";
import {AdminState} from "../src/admin-state.js";

class MemoryStorage{
  constructor(){this.map=new Map()}
  async get(key){return this.map.get(key)}
  async put(key,value){this.map.set(key,structuredClone(value))}
  async delete(key){this.map.delete(key)}
}
const storage=new MemoryStorage(),state=new AdminState({storage},{});
const call=async(path,method="GET",body)=>{
  const init={method,headers:{"content-type":"application/json"}};
  if(body!==undefined)init.body=JSON.stringify(body);
  const response=await state.fetch(new Request(`https://admin-state.internal${path}`,init));
  return {status:response.status,body:await response.json()};
};

{
  const first=await call("/operation-lock/acquire","POST",{owner:"owner-1",kind:"candidate-build",lease_seconds:30});
  assert.equal(first.status,200);assert.equal(first.body.ok,true);assert.equal(first.body.active.owner,"owner-1");
  const second=await call("/operation-lock/acquire","POST",{owner:"owner-2",kind:"candidate-build",lease_seconds:30});
  assert.equal(second.status,409);assert.equal(second.body.error,"ADMIN_OPERATION_BUSY");
  const wrong=await call("/operation-lock/release","POST",{owner:"owner-2"});
  assert.equal(wrong.status,409);assert.equal(wrong.body.error,"ADMIN_OPERATION_LOCK_OWNER_MISMATCH");
  const released=await call("/operation-lock/release","POST",{owner:"owner-1"});
  assert.equal(released.status,200);assert.equal(released.body.released,true);
}

{
  await call("/operation-lock/acquire","POST",{owner:"candidate-owner",kind:"candidate-build",lease_seconds:30});
  const record={candidate_id:"candidate-1",manifest:{candidate_kind:"cloudflare-dry-run-build-set"},candidate_digest:"a".repeat(64)};
  const stored=await call("/candidate","POST",{candidate_id:"candidate-1",record});
  assert.equal(stored.status,201);assert.equal(stored.body.operation_lock_released,true);
  const lock=await call("/operation-lock");assert.equal(lock.body.active,null);
}

{
  await call("/operation-lock/acquire","POST",{owner:"validation-owner",kind:"candidate-validation",lease_seconds:30});
  const acceptance={run_id:"acc-1",validation:"PASS",completed_at:"2026-08-16T00:00:00.000Z",receipt_digest:"b".repeat(64)};
  const stored=await call("/acceptance","POST",{run_id:"acc-1",candidate_id:"candidate-1",record:acceptance});
  assert.equal(stored.status,201);assert.equal(stored.body.operation_lock_released,true);
  const lock=await call("/operation-lock");assert.equal(lock.body.active,null);
}

{
  await storage.put("admin:operation-lock",{owner:"expired",kind:"candidate-build",expires_at_ms:Date.now()-1});
  const lock=await call("/operation-lock");
  assert.equal(lock.status,200);assert.equal(lock.body.active,null);assert.equal(await storage.get("admin:operation-lock"),undefined);
}

console.log(JSON.stringify({ok:true,suite:"governance-admin-operation-lock",single_admin_operation:true,busy_status:409,owner_checked:true,candidate_store_releases:true,acceptance_store_releases:true,expired_lock_cleared:true}));
