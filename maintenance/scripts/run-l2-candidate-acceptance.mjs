#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const WRANGLER="4.123.0";
const ADMIN="admin-worker";
const TAG_PATTERN=/^[a-f0-9]{12}$/i;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanJson(text){
  const raw=String(text||"").replace(/\x1b\[[0-9;]*m/g,"").trim();
  const starts=[raw.indexOf("["),raw.indexOf("{")].filter(i=>i>=0).sort((a,b)=>a-b);
  if(!starts.length)throw new Error("WRANGLER_JSON_MISSING");
  return JSON.parse(raw.slice(starts[0]));
}
function childEnv(overrides={},stripCiOverride=false){
  const env={...process.env,CI:"1",...overrides};
  if(stripCiOverride)delete env.WRANGLER_CI_OVERRIDE_NAME;
  return env;
}
function run(command,args,cwd,{stdio="pipe",envOverrides={},stripCiOverride=false}={}){
  const r=spawnSync(command,args,{cwd,encoding:"utf8",env:childEnv(envOverrides,stripCiOverride),stdio,maxBuffer:4*1024*1024});
  if(r.error||r.status!==0)throw Object.assign(new Error(`${command.toUpperCase()}_FAILED:${args.join(" ")}`),{stdout:r.stdout,stderr:r.stderr});
  return r;
}
function adminWrangler(args,cwd,options={}){
  return run("npx",["--yes",`wrangler@${WRANGLER}`,...args],cwd,{...options,envOverrides:{...(options.envOverrides||{}),WRANGLER_CI_OVERRIDE_NAME:ADMIN}});
}
function idOf(x){return String(x?.version_id||x?.versionId||x?.id||"").trim()}
function tagOf(x){return String(x?.tag||x?.annotations?.["workers/tag"]||"").trim()}
function rows(payload){return Array.isArray(payload)?payload:Array.isArray(payload?.versions)?payload.versions:Array.isArray(payload?.result)?payload.result:[]}
function candidateByTag(payload,tag){
  const ids=[...new Set(rows(payload).filter(x=>tagOf(x)===tag&&UUID_PATTERN.test(idOf(x))).map(idOf))];
  if(ids.length>1)throw new Error(`ADMIN_CANDIDATE_TAG_AMBIGUOUS:${tag}:${ids.length}`);
  return ids[0]||null;
}
function listAdmin(cwd){return cleanJson(adminWrangler(["versions","list","--name",ADMIN,"--json"],cwd).stdout)}
function ensureAdminCandidate(tag){
  const cwd=resolve(process.cwd(),"../admin");
  const existing=candidateByTag(listAdmin(cwd),tag);
  if(existing)return{version_id:existing,reused:true};
  run("npm",["run","cf:build"],cwd,{stdio:"inherit",stripCiOverride:true});
  adminWrangler(["versions","upload","--name",ADMIN,"--tag",tag,"--message",`L2 self-contained admin candidate ${tag}`],cwd,{stdio:"inherit"});
  const created=candidateByTag(listAdmin(cwd),tag);
  if(!created)throw new Error(`ADMIN_CANDIDATE_NOT_FOUND_AFTER_UPLOAD:${tag}`);
  return{version_id:created,reused:false};
}
function main(){
  const tag=String(process.env.WORKERS_CI_COMMIT_SHA||"").slice(0,12);
  if(!TAG_PATTERN.test(tag))throw new Error("L2_TAG_INVALID");
  const admin=ensureAdminCandidate(tag);
  console.log(JSON.stringify({event:"L2_SELF_CONTAINED_ADMIN_CANDIDATE_READY",tag,...admin,secrets_redacted:true}));
  run(process.execPath,[resolve(process.cwd(),"scripts/run-l2-candidate-acceptance-core.mjs")],process.cwd(),{stdio:"inherit",stripCiOverride:true});
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||"")).href){try{main()}catch(error){console.error(JSON.stringify({event:"L2_SELF_CONTAINED_PREP_FAIL",error:String(error?.message||error),secrets_redacted:true}));process.exitCode=1}}
