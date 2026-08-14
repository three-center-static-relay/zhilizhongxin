import {mkdir,writeFile,rm} from "node:fs/promises";
import {dirname,join} from "node:path";
import {spawnSync} from "node:child_process";

const CASES=[
  {name:"intelligence",repo:"qingbaozhongxin",sha:"4eabcfd47eab176e62347cb0551f43ad404a0515",files:["src/guard.js","src/index.js","src/catalog.js","src/catalog-base.js","src/adapters.js","src/adapters-core.js","src/adapters-extra.js","src/adapters-extra2.js","src/adapters-extra3.js","src/adapters-extra4.js","wrangler.test.jsonc","tests/stress.mjs"]},
  {name:"expert",repo:"zhuanjiatuan",sha:"088d400f8fdea40600126e933f5595a6f16a8bd5",files:["src/guard.js","src/index.js","wrangler.test.jsonc","tests/stress.mjs"]}
];
const hard=setTimeout(()=>{console.error("CROSS_CENTER_WATCHDOG_TIMEOUT");process.exit(124)},130000);
const root=join(process.cwd(),".tmp-cross-centers");
try{
  await rm(root,{recursive:true,force:true});
  for(const c of CASES){
    const dir=join(root,c.name),base=`https://raw.githubusercontent.com/three-center-static-relay/${c.repo}/${c.sha}`;
    for(const file of c.files){const r=await fetch(`${base}/${file}`,{headers:{accept:"text/plain"}});if(!r.ok)throw new Error(`FETCH_FAILED:${c.name}:${file}:${r.status}`);const p=join(dir,file);await mkdir(dirname(p),{recursive:true});await writeFile(p,await r.text(),"utf8")}
    const out=spawnSync(process.execPath,["tests/stress.mjs"],{cwd:dir,stdio:"inherit",timeout:55000,env:{...process.env}});
    if(out.error)throw out.error;if(out.status!==0)throw new Error(`${c.name.toUpperCase()}_STRESS_EXIT:${out.status}`);
    console.log(JSON.stringify({ok:true,suite:`cross-${c.name}-stress`,source_commit:c.sha,runner:"governance-worker-build"}));
  }
}finally{await rm(root,{recursive:true,force:true}).catch(()=>{});clearTimeout(hard)}
