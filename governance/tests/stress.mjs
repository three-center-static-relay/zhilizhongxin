import assert from "node:assert/strict";
import {createTestHarness} from "wrangler";
const watchdog=setTimeout(()=>{console.error("GOVERNANCE_STRESS_TIMEOUT");process.exit(124)},30000);
const within=(p,ms,label)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error(`TIMEOUT:${label}`)),ms))]);
const server=createTestHarness({workers:[{configPath:"./wrangler.test.jsonc"}]});
async function waves(total,width,fn,label){const out=[];for(let base=0;base<total;base+=width){const part=await within(Promise.all(Array.from({length:Math.min(width,total-base)},(_,i)=>fn(base+i))),6000,`${label}-${base}`);out.push(...part)}return out}
let exitCode=0;
try{
  await within(server.listen(),8000,"listen");
  const paths=["/health","/v1/policy","/v1/capabilities","/source"];
  const reads=await waves(512,64,i=>server.fetch(paths[i%paths.length]),"read-wave");
  assert.equal(reads.filter(r=>r.status===200).length,512,"all governance reads must survive 64-way waves");
  const digests=await waves(128,32,async()=>{const r=await server.fetch("/source");const b=await r.json();return b.source_digest},"digest-wave");
  assert.equal(new Set(digests).size,1,"source digest must remain deterministic under concurrent waves");
  const methods=["POST","PUT","PATCH","DELETE"];
  const writes=await waves(256,64,i=>server.fetch(`/v1/forbidden/${i}`,{method:methods[i%methods.length],headers:{"content-type":"application/json"},...(methods[i%methods.length]==="DELETE"?{}:{body:JSON.stringify({attempt:"write",i})})}),"write-wave");
  assert.equal(writes.filter(r=>r.status===403).length,256,"every mutation attempt must be denied");
  const probes=await Promise.all([server.fetch("/v1/admin",{method:"POST"}),server.fetch("/v1/policy",{method:"POST"}),server.fetch("/source",{method:"DELETE"}),server.fetch("/etc/passwd")]);
  assert.equal(probes.filter(r=>r.status===403).length,4,"privilege/path probes must fail closed");
  const cap=await (await server.fetch("/v1/capabilities")).json();assert.equal(cap.capabilities?.production_write,false);const pol=await (await server.fetch("/v1/policy")).json();assert.equal(pol.policy?.fail_closed,true);assert.equal(pol.policy?.negative_value_changes,"deny");
  console.log(JSON.stringify({ok:true,suite:"governance-stress",max_parallel:64,read_total:512,digest_total:128,write_deny_total:256,tests:["read-stability","digest-determinism","write-deny","privilege-probes","fail-closed-policy"]}));
}catch(e){exitCode=1;console.error(e)}
try{await Promise.race([server.close(),new Promise(r=>setTimeout(r,1500))])}catch{}
clearTimeout(watchdog);process.exit(exitCode);
