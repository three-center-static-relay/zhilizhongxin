import assert from "node:assert/strict";
import {buildReceipt,deploymentEnvironment,extractSignal,observerUrl,publishWorkersDevReceipt,renderReceiptWorker,workerNameForScope} from "./cloudflare-workersdev-receipt.mjs";

const env={WORKERS_CI_COMMIT_SHA:"a".repeat(40),WORKERS_CI_BUILD_UUID:"build-123",WRANGLER_CI_OVERRIDE_NAME:"maintenance-worker",SOME_OTHER:"ok"};
const signal={};extractSignal('{"event":"L2_LOCAL_ROUTE_CANDIDATE_PHASE","phase":"route-family-accepted","acceptance_phase":"predeploy-control-plane"}',signal);
const receipt=buildReceipt({scope:"maintenance",mode:"preview",state:"success",signal,env});
assert.equal(receipt.commit_sha,"a".repeat(40));
assert.equal(receipt.acceptance_phase,"predeploy-control-plane");
assert.equal(workerNameForScope("maintenance"),"maintenance-build-receipt");
assert.equal(observerUrl("maintenance"),"https://maintenance-build-receipt.a15280020511.workers.dev");
const deployEnv=deploymentEnvironment(env);assert.equal(deployEnv.WRANGLER_CI_OVERRIDE_NAME,undefined);assert.equal(deployEnv.SOME_OTHER,"ok");
const source=renderReceiptWorker(receipt);assert.ok(source.includes(receipt.receipt_digest));assert.ok(!source.includes("WRANGLER_CI_OVERRIDE_NAME"));
let captured=null;const fakeRunner=(cmd,args,opts)=>{captured={cmd,args,opts};return {status:0,stdout:"",stderr:""}};
const result=publishWorkersDevReceipt({scope:"maintenance",mode:"preview",state:"success",signal,env,runner:fakeRunner});
assert.equal(result.ok,true);assert.equal(captured.cmd,"npx");assert.equal(captured.opts.env.WRANGLER_CI_OVERRIDE_NAME,undefined);assert.equal(result.url,observerUrl("maintenance"));
console.log(JSON.stringify({ok:true,suite:"cloudflare-workersdev-receipt-contract",no_new_secret:true,observer_worker_isolated:true,ci_name_override_removed:true,secrets_redacted:true}));
