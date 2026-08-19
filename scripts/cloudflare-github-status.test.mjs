import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {clean,descriptionFor,extractSignal,publishCommitStatus,receiptDigest} from "./cloudflare-github-status.mjs";

assert.equal(clean("abc secret\nx"),"abc_secret_x");
const signal={};
extractSignal('{"event":"L2_LOCAL_ROUTE_CANDIDATE_PHASE","phase":"route-family-accepted","acceptance_phase":"predeploy-control-plane"}',signal);
assert.equal(signal.phase,"route-family-accepted");
assert.equal(signal.acceptance_phase,"predeploy-control-plane");

const desc=descriptionFor({scope:"maintenance",mode:"preview",state:"success",sha:"a".repeat(40),build_uuid:"12345678-1234-1234-1234-123456789abc",signal});
assert.ok(desc.startsWith("PASS preview predeploy-control-plane"));
assert.ok(desc.length<=140);
assert.equal(receiptDigest({a:1}),receiptDigest({a:1}));

let captured=null;
const fakeFetch=async(url,init)=>{captured={url,init};return {ok:true,status:201}};
const env={
  WORKERS_CI_COMMIT_SHA:"a".repeat(40),
  WORKERS_CI_BUILD_UUID:"build-123",
  GITHUB_RECEIPT_REPOSITORY:"three-center-static-relay/zhilizhongxin",
  GITHUB_COMMIT_STATUS_TOKEN:"super-secret-token"
};
const posted=await publishCommitStatus({scope:"maintenance",mode:"preview",state:"success",signal,env,fetchImpl:fakeFetch});
assert.equal(posted.ok,true);
assert.match(captured.url,/statuses\/aaaaaaaa/);
assert.equal(captured.init.headers.authorization,"Bearer super-secret-token");
assert.ok(!JSON.stringify(posted).includes("super-secret-token"));
assert.ok(!captured.init.body.includes("super-secret-token"));

const missing=await publishCommitStatus({scope:"maintenance",mode:"preview",state:"success",signal,env:{...env,GITHUB_COMMIT_STATUS_TOKEN:""},fetchImpl:fakeFetch});
assert.equal(missing.skipped,true);
assert.equal(missing.code,"GITHUB_STATUS_TOKEN_MISSING");

const runner=fileURLToPath(new URL("./cloudflare-receipt-runner.mjs",import.meta.url));
const failed=spawnSync(process.execPath,[runner,"maintenance","preview","definitely-not-a-real-executable"],{
  encoding:"utf8",
  env:{...process.env,WORKERS_CI_COMMIT_SHA:"a".repeat(40),GITHUB_RECEIPT_REPOSITORY:"three-center-static-relay/zhilizhongxin",GITHUB_COMMIT_STATUS_TOKEN:""}
});
assert.equal(failed.status,1);
assert.match(String(failed.stderr||""),/CLOUDFLARE_GITHUB_STATUS/);
assert.doesNotMatch(String(failed.stderr||""),/Unhandled 'error' event/);

console.log(JSON.stringify({ok:true,suite:"cloudflare-github-status-contract",commit_status_only:true,secrets_redacted:true,observability_fail_open:true,spawn_failure_bounded:true}));
