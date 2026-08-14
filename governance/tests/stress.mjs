import assert from "node:assert/strict";
import {createTestHarness} from "wrangler";
const watchdog=setTimeout(()=>{console.error("GOVERNANCE_STRESS_TIMEOUT");process.exit(124)},30000);
const within=(p,ms,label)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error(`TIMEOUT:${label}`)),ms))]);
const server=createTestHarness({workers:[{configPath:"./wrangler.test.jsonc"}]});
let exitCode=0;
try{
  await within(server.listen(),8000,"listen");
  const paths=["/health","/v1/policy","/v1/capabilities","/source"];
  const reads=await within(Promise.all(Array.from({length:512},(_,i)=>server.fetch(paths[i%paths.length]))),10000,"read-burst");
  assert.equal(reads.filter(r=>r.status===200).length,512,"all governance reads must survive burst load");
  const digests=await within(Promise.all(Array.from({length:128},async()=>{const r=await server.fetch("/source");const b=await r.json();return b.source_digest})),8000,"digest-burst");
  assert.equal(new Set(digests).size,1,"source digest must remain deterministic under concurrency");
  const methods=["POST","PUT","PATCH","DELETE"];
  const writes=await within(Promise.all(Array.from({length:256},(_,i)=>server.fetch(`/v1/forbidden/${i}`,{method:methods[i%methods.length],headers:{"content-type":"application/json"},body:methods[i%methods.length]==="DELETE"?undefined:JSON.stringify({attempt:"write",i})}))),10000,"write-deny-burst");
  assert.equal(writes.filter(r=>r.status===403).length,256,"every mutation attempt must be denied");
  const probes=await Promise.all([server.fetch("/v1/admin",{method:"POST"}),server.fetch("/v1/policy",{method:"POST"}),server.fetch("/source",{method:"DELETE"}),server.fetch("/../../etc/passwd")]);
  assert.equal(probes.filter(r=>r.status===403).length,4,"privilege/path probes must fail closed");
  const cap=await (await server.fetch("/v1/capabilities")).json();assert.equal(cap.capabilities?.production_write,false);const pol=await (await server.fetch("/v1/policy")).json();assert.equal(pol.policy?.fail_closed,true);assert.equal(pol.policy?.negative_value_changes,"deny");
  console.log(JSON.stringify({ok:true,suite:"governance-stress",read_burst:512,digest_burst:128,write_deny_burst:256,tests:["read-stability","digest-determinism","write-deny","privilege-probes","fail-closed-policy"]}));
}catch(e){exitCode=1;try{server.debug()}catch{}console.error(e)}
try{await Promise.race([server.close(),new Promise(r=>setTimeout(r,1500))])}catch{}
clearTimeout(watchdog);process.exit(exitCode);
