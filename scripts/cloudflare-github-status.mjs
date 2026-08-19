#!/usr/bin/env node
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";

const SHA_PATTERN=/^[a-f0-9]{40,64}$/i;
const REPO_PATTERN=/^[0-9A-Za-z_.-]+\/[0-9A-Za-z_.-]+$/;
const STATES=new Set(["pending","success","failure","error"]);

export function clean(value,max=120){
  return String(value??"").replace(/[^0-9A-Za-z._:/,=@+-]/g,"_").slice(0,max);
}
export function extractSignal(line,signal={}){
  const text=String(line||"").trim();
  if(!text.startsWith("{")||!text.endsWith("}"))return signal;
  try{
    const row=JSON.parse(text);
    for(const key of ["phase","acceptance_phase","code","event"]){
      if(row?.[key]!=null&&String(row[key]).trim())signal[key]=clean(row[key],100);
    }
  }catch{}
  return signal;
}
export function receiptDigest(payload){
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0,16);
}
export function descriptionFor(payload){
  const label=payload.state==="success"?"PASS":payload.state==="pending"?"RUN":"FAIL";
  const phase=clean(payload.signal?.acceptance_phase||payload.signal?.phase||payload.signal?.code||payload.signal?.event||payload.mode||"build",52);
  const build=clean(payload.build_uuid||"unknown",16);
  const digest=receiptDigest({
    schema:"cloudflare-github-status-v1",
    scope:payload.scope,
    mode:payload.mode,
    sha:payload.sha,
    build_uuid:payload.build_uuid||null,
    state:payload.state,
    signal:payload.signal||{}
  });
  return `${label} ${payload.mode} ${phase} b=${build} d=${digest}`.replace(/[^\x20-\x7E]/g,"_").replace(/\s+/g," ").slice(0,140);
}
function repositoryFromRemote(){
  const r=spawnSync("git",["remote","get-url","origin"],{encoding:"utf8"});
  if(r.error||r.status!==0)return "";
  const remote=String(r.stdout||"").trim();
  if(!remote)return "";
  try{
    if(remote.includes("://")){
      const u=new URL(remote);
      const parts=u.pathname.replace(/^\/+/,"").replace(/\.git$/i,"").split("/").filter(Boolean);
      if(parts.length>=2)return `${parts.at(-2)}/${parts.at(-1)}`;
    }
  }catch{}
  const m=remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return m?`${m[1]}/${m[2]}`:"";
}
function targetUrl(env,scope,buildUuid){
  const account=clean(env.CLOUDFLARE_ACCOUNT_ID||"",64);
  if(!account||!buildUuid)return undefined;
  const worker=clean(env.CLOUDFLARE_RECEIPT_WORKER_NAME||`${scope}-worker`,80);
  return `https://dash.cloudflare.com/?to=/${account}/workers/services/view/${worker}/production/builds/${encodeURIComponent(buildUuid)}`;
}

export async function publishCommitStatus({scope,mode,state,signal={},env=process.env,fetchImpl=globalThis.fetch}){
  if(!STATES.has(state))throw new Error("GITHUB_STATUS_STATE_INVALID");
  const sha=String(env.WORKERS_CI_COMMIT_SHA||"").trim();
  if(!SHA_PATTERN.test(sha))return {ok:false,skipped:true,code:"GITHUB_STATUS_SHA_UNAVAILABLE"};
  const repo=String(env.GITHUB_RECEIPT_REPOSITORY||repositoryFromRemote()).trim();
  if(!REPO_PATTERN.test(repo))return {ok:false,skipped:true,code:"GITHUB_STATUS_REPOSITORY_UNAVAILABLE"};
  const token=String(env.GITHUB_COMMIT_STATUS_TOKEN||"").trim();
  if(!token)return {ok:false,skipped:true,code:"GITHUB_STATUS_TOKEN_MISSING",repository:repo,commit_sha:sha};

  const buildUuid=clean(env.WORKERS_CI_BUILD_UUID||"",80)||null;
  const payload={scope:clean(scope,40),mode:clean(mode,20),state,sha,build_uuid:buildUuid,signal:{...signal}};
  const body={
    state,
    context:`cloudflare/${payload.scope}`,
    description:descriptionFor(payload)
  };
  const target=targetUrl(env,payload.scope,buildUuid);
  if(target)body.target_url=target;

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetchImpl(`https://api.github.com/repos/${repo}/statuses/${sha}`,{
      method:"POST",
      headers:{
        authorization:`Bearer ${token}`,
        accept:"application/vnd.github+json",
        "content-type":"application/json",
        "x-github-api-version":"2022-11-28",
        "user-agent":"three-center-cloudflare-receipt/1"
      },
      body:JSON.stringify(body),
      signal:controller.signal
    });
    if(!response.ok){
      return {ok:false,skipped:false,code:"GITHUB_STATUS_POST_FAILED",http_status:response.status,repository:repo,commit_sha:sha,context:body.context,description:body.description};
    }
    return {ok:true,skipped:false,code:"GITHUB_STATUS_POSTED",repository:repo,commit_sha:sha,context:body.context,state,description:body.description,build_uuid:buildUuid};
  }catch(error){
    return {ok:false,skipped:false,code:error?.name==="AbortError"?"GITHUB_STATUS_POST_TIMEOUT":"GITHUB_STATUS_POST_ERROR",repository:repo,commit_sha:sha,error:clean(error?.message||error,120)};
  }finally{
    clearTimeout(timer);
  }
}
