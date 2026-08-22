// Codex runtime contract: fail closed when governance dependencies are missing.
import assert from "node:assert/strict";
import { createCodexRuntime } from "../src/codex-runtime-adapter.js";

const receipts=[];
const runtime=createCodexRuntime({
  constitutionGate: async()=>({pass:true}),
  modelResolver: async()=>({provider:"workers-ai",model:"free-best-candidate"}),
  receiptWriter: async(r)=>receipts.push(r),
});

const receipt=await runtime.executeMaintenanceTask({id:"contract-test"});
assert.equal(receipt.constitution_gate_pass,true);
assert.equal(receipts.length,1);
assert.equal(receipts[0].component,"codex-runtime");

console.log(JSON.stringify({ok:true,test:"codex-runtime-contract"}));
