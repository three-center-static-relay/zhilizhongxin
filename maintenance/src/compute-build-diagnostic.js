const TARGET_SHA="e759194aad3b110e40bb55c15c05b3df4b5cea7f";
const API="https://api.cloudflare.com/client/v4";
const SCRIPT="compute-worker";
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const safeString=v=>{const s=String(v??"").trim();return /^[0-9A-Za-z_.:\/-]{1,120}$/.test(s)?s:null};
function walk(value,path="",out={strings:[],keys:[],codes:[]},depth=0){
  if(depth>7)return out;
  if(Array.isArray(value)){for(let i=0;i<Math.min(value.length,20);i++)walk(value[i],`${path}[${i}]`,out,depth+1);return out}
  if(value&&typeof value==="object"){
    for(const [k,v] of Object.entries(value).slice(0,80)){
      const p=path?`${path}.${k}`:k;out.keys.push(p);
      if(/(?:code|status|state|outcome|phase|stage)$/i.test(k)&&["string","number","boolean"].includes(typeof v)){const s=safeString(v);if(s)out.codes.push({path:p,value:s})}
      walk(v,p,out,depth+1);
    }
    return out;
  }
  if(["string","number","boolean"].includes(typeof value)){const s=safeString(value);if(s)out.strings.push({path,value:s})}
  return out;
}
function firstByPath(items,patterns){for(const re of patterns){const hit=items.find(x=>re.test(x.path));if(hit)return hit.value}return null}
function summarize(build){
  const w=walk(build),targetPresent=w.strings.some(x=>String(x.value).toLowerCase()===TARGET_SHA),sha=firstByPath(w.strings,[/(?:commit|revision).*sha$/i,/(?:commit|revision).*hash$/i,/(?:^|\.)sha$/i]),branch=firstByPath(w.strings,[/(?:^|\.)branch$/i,/branch_name$/i]),status=firstByPath(w.codes,[/(?:^|\.)(?:status|state|outcome)$/i,/build.*(?:status|state|outcome)$/i]);
  const errorCode=w.codes.find(x=>/(?:error|fail).*code/i.test(x.path))?.value||null;
  return{target_commit_present:targetPresent,observed_commit_sha:/^[a-f0-9]{40,64}$/i.test(String(sha||""))?sha:null,branch:safeString(branch),status:safeString(status),error_code:safeString(errorCode),failure_indicator_present:w.keys.some(k=>/(?:error|failure|failed)/i.test(k)),schema_keys_sample:[...new Set(w.keys)].slice(0,40)};
}
export async function computeBuildDiagnostic(env){
  const token=String(env.CF_API_TOKEN||"").trim(),account=String(env.CF_ACCOUNT_ID||"").trim();
  if(!token||!account)return json({ok:false,diagnostic:"compute-build-status",configured:false,target_commit:TARGET_SHA,error:"CLOUDFLARE_CONTROL_PLANE_NOT_CONFIGURED",secrets_redacted:true},503);
  const url=`${API}/accounts/${encodeURIComponent(account)}/builds/workers/${SCRIPT}/builds?page=1&per_page=5`;
  try{
    const response=await fetch(url,{method:"GET",headers:{authorization:`Bearer ${token}`,accept:"application/json"}}),body=await response.json().catch(()=>null);
    const rows=Array.isArray(body?.result)?body.result:Array.isArray(body?.result?.builds)?body.result.builds:[];
    const summaries=rows.slice(0,5).map(summarize),targetIndex=summaries.findIndex(x=>x.target_commit_present===true||x.observed_commit_sha===TARGET_SHA);
    return json({ok:response.ok&&body?.success===true,diagnostic:"compute-build-status",configured:true,http_status:response.status,target_commit:TARGET_SHA,build_count:rows.length,target_build_found:targetIndex>=0,target_build_index:targetIndex>=0?targetIndex:null,latest:summaries[0]||null,target:targetIndex>=0?summaries[targetIndex]:null,secrets_redacted:true,raw_logs_exposed:false,account_id_exposed:false},response.ok&&body?.success===true?200:502);
  }catch(e){return json({ok:false,diagnostic:"compute-build-status",configured:true,target_commit:TARGET_SHA,error_class:String(e?.name||"Error").slice(0,80),secrets_redacted:true,raw_logs_exposed:false,account_id_exposed:false},502)}
}
