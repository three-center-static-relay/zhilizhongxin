import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";

// Shared-build trigger for synchronized Tencent runtime-state diagnosis; no behavior change.
const SHA=/^[a-f0-9]{40,64}$/i;

export async function fetchAttestation(base,expectedCommit){
  assert.match(base,/^https:\/\/[a-z0-9.-]+\.workers\.dev$/i,"VALID_WORKERS_DEV_URL_REQUIRED");
  assert.match(expectedCommit,SHA,"VALID_ATTESTED_COMMIT_REQUIRED");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(`${base.replace(/\/+$/,'')}/_internal/tencent-production-attestation`,{
      method:"GET",headers:{accept:"application/json"},signal:controller.signal
    });
    const body=await response.json().catch(()=>null);
    assert.equal(response.status,200,`ATTESTATION_HTTP_${response.status}`);
    assert.equal(body?.ok,true,"ATTESTATION_OK_REQUIRED");
    assert.equal(body?.validation,"PASS","ATTESTATION_PASS_REQUIRED");
    assert.equal(body?.runtime_e2e,true,"ATTESTATION_RUNTIME_E2E_REQUIRED");
    assert.equal(body?.selftest,"executor-runtime-v5","ATTESTATION_SELFTEST_MISMATCH");
    assert.equal(body?.attested_commit,expectedCommit,"ATTESTATION_COMMIT_MISMATCH");
    assert.equal(body?.checks_required,15,"ATTESTATION_CHECK_COUNT_MISMATCH");
    assert.equal(body?.stable_domain_required,true,"ATTESTATION_STABLE_DOMAIN_REQUIRED");
    assert.equal(body?.shell_file_python_chromium_required,true,"ATTESTATION_ACTIVE_TOOLS_REQUIRED");
    assert.equal(body?.fail_closed,true,"ATTESTATION_FAIL_CLOSED_REQUIRED");
    assert.equal(body?.secret_values_exposed,false,"ATTESTATION_SECRET_EXPOSURE");
    assert.equal(body?.deploy_probe_active,false,"ATTESTATION_PROBE_MUST_BE_REMOVED");
    return body;
  }finally{clearTimeout(timer)}
}

function adminBase(repoRoot){
  const spec=JSON.parse(readFileSync(resolve(repoRoot,"admin/openapi.json"),"utf8"));
  const base=String(spec?.servers?.[0]?.url||"").replace(/\/+$/,'');
  if(!base)throw new Error("ADMIN_OPENAPI_SERVER_REQUIRED");
  return base;
}

function parentSha(repoRoot,sha){
  const result=spawnSync("git",["cat-file","-p",sha],{cwd:repoRoot,encoding:"utf8",env:process.env});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error("GIT_PARENT_LOOKUP_FAILED");
  const parent=result.stdout.match(/^parent ([a-f0-9]{40,64})$/im)?.[1]||"";
  if(!SHA.test(parent))throw new Error("VALID_PARENT_COMMIT_REQUIRED");
  return parent;
}

async function main(){
  const mode=process.argv[2]||"direct";
  const repoRoot=process.cwd().endsWith("/admin")?resolve(process.cwd(),".."):process.cwd();
  if(mode==="preview-marker"){
    const marker=resolve(repoRoot,"admin/canary/tencent-production-attestation-verify.txt");
    if(!existsSync(marker)){
      console.log(JSON.stringify({ok:true,skipped:true,suite:"tencent-production-attestation",reason:"MARKER_ABSENT"}));
      return;
    }
    if(process.env.WORKERS_CI!=="1"||process.env.WORKERS_CI_BRANCH==="main")throw new Error("ATTESTATION_PREVIEW_CONTEXT_REQUIRED");
    const current=String(process.env.WORKERS_CI_COMMIT_SHA||"");
    if(!SHA.test(current))throw new Error("VALID_WORKERS_CI_COMMIT_SHA_REQUIRED");
    const expected=parentSha(repoRoot,current),base=adminBase(repoRoot);
    const body=await fetchAttestation(base,expected);
    console.log(JSON.stringify({ok:true,skipped:false,suite:"tencent-production-attestation",attested_commit:body.attested_commit,runtime_e2e:true,deploy_probe_active:false}));
    return;
  }
  const base=String(process.argv[2]||""),expected=String(process.argv[3]||"");
  const body=await fetchAttestation(base,expected);
  console.log(JSON.stringify({ok:true,suite:"tencent-production-attestation",attested_commit:body.attested_commit,runtime_e2e:true,deploy_probe_active:false}));
}

if(import.meta.url===new URL(`file://${process.argv[1]}`).href)main().catch(error=>{console.error(error?.stack||String(error));process.exit(1)});
