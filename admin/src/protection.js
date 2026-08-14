export const PROTECTION_VERSION="2026-08-15.1";
const EXPECTED_MANAGED=["admin-worker","governance-worker","intelligence-worker","compute-worker","expert-worker","maintenance-worker"];
const RULES={
  admin:{
    "/v1/admin/capabilities":{"auth":"bearer","service_bindings":true,"single_task_lock":true,"candidate_validation":true,"bounded_acceptance":true,"rollback":true,"auto_promote":false,"fail_closed":true},
    "/v1/admin/quotas":{"auto_promote":false}
  },
  governance:{
    "/v1/policy":{"policy.fail_closed":true,"policy.business_secrets":false,"policy.arbitrary_code":false,"policy.github_actions_required":false,"policy.negative_value_changes":"deny","policy.stability_first":true,"policy.center_isolation":true},
    "/v1/capabilities":{"capabilities.production_write":false}
  },
  intelligence:{
    "/v1/policy":{"policy.fail_closed":true,"policy.single_active_task":true,"policy.network":"allowlisted-upstreams-only","policy.arbitrary_url_fetch":false,"policy.arbitrary_code":false,"policy.max_retries":1,"policy.task_persistence":"operational-metadata-only"}
  },
  compute:{
    "/v1/policy":{"policy.fail_closed":true,"policy.single_active_task":true,"policy.cloudflare_heavy_compute":false,"policy.executor":"kaggle","policy.arbitrary_code_upload":false,"policy.arbitrary_shell":false,"policy.max_retries":1,"policy.timeout_cleanup":true,"policy.duplicate_task_rejected":true}
  },
  expert:{
    "/v1/policy":{"policy.fail_closed":true,"policy.single_active_task":true,"policy.network":"openrouter-only","policy.tools":false,"policy.web":false,"policy.history_weight":0,"policy.reasoning_effort":"high","policy.exclude_free":true,"policy.exclude_flash":true,"policy.max_retries":0,"policy.max_models":4,"policy.judge_required":true,"policy.model_selection":"reasoning+most-popular"}
  },
  maintenance:{
    "/health":{"service":"maintenance-worker","status":"ready"}
  }
};
function at(o,path){return String(path).split(".").reduce((v,k)=>v==null?undefined:v[k],o)}
function same(a,b){if(Array.isArray(b))return Array.isArray(a)&&b.every(x=>a.includes(x));return Object.is(a,b)}
function bind(env,n){return{governance:env.GOVERNANCE_CENTER,intelligence:env.INTELLIGENCE_CENTER,compute:env.COMPUTE_CENTER,expert:env.EXPERT_CENTER,maintenance:env.MAINTENANCE_CENTER}[n]||null}
async function serviceJson(env,n,path,init={}){const b=bind(env,n);if(!b?.fetch)return{ok:false,http_status:503,body:null,error:"CENTER_UNCONFIGURED"};const c=new AbortController(),t=setTimeout(()=>c.abort(),8000);try{const r=await b.fetch(new Request(`https://${n}.internal${path}`,{...init,headers:{accept:"application/json",...(init.headers||{})},signal:c.signal}));const body=await r.json().catch(()=>null);return{ok:r.ok,http_status:r.status,body}}catch(e){return{ok:false,http_status:503,body:null,error:String(e?.message||e)}}finally{clearTimeout(t)}}
function checksFor(n,path,body){const spec=RULES[n]?.[path]||{},out=[];for(const [field,expected] of Object.entries(spec)){const actual=at(body,field);out.push({center:n,path,field,expected,actual,ok:same(actual,expected)});}return out}
export function protectionBaseline(){return{version:PROTECTION_VERSION,mode:"runtime-invariant-baseline",rules:RULES,github_path_hard_lock:"external-ruleset-required",protected_core_auto_upgrade:false}}
export async function verifyProtection(env,adminBase){const checks=[];
  const scripts=String(env.MANAGED_SCRIPTS||"").split(",").map(x=>x.trim()).filter(Boolean).sort();
  checks.push({center:"admin",field:"env.AUTO_PROMOTE",expected:"false",actual:String(env.AUTO_PROMOTE||""),ok:String(env.AUTO_PROMOTE||"")==="false"});
  checks.push({center:"admin",field:"env.MANAGED_SCRIPTS",expected:EXPECTED_MANAGED.slice().sort(),actual:scripts,ok:JSON.stringify(scripts)===JSON.stringify(EXPECTED_MANAGED.slice().sort())});
  for(const path of Object.keys(RULES.admin)){
    try{const r=await adminBase.fetch(new Request(`https://admin.internal${path}`,{headers:{accept:"application/json",authorization:`Bearer ${env.ADMIN_GPT_TOKEN||""}`}}),env,{waitUntil(){}});const body=await r.json().catch(()=>null);checks.push({center:"admin",path,name:"route",ok:r.ok,http_status:r.status});checks.push(...checksFor("admin",path,body));}catch(e){checks.push({center:"admin",path,name:"route",ok:false,error:String(e?.message||e)})}
  }
  for(const n of ["governance","intelligence","compute","expert","maintenance"]){for(const path of Object.keys(RULES[n])){const r=await serviceJson(env,n,path);checks.push({center:n,path,name:"route",ok:r.ok,http_status:r.http_status,...(r.error?{error:r.error}:{})});if(r.body)checks.push(...checksFor(n,path,r.body));}}
  const ro=await serviceJson(env,"maintenance","/v1/maintenance/latest",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});checks.push({center:"maintenance",path:"/v1/maintenance/latest",field:"write_denied",expected:403,actual:ro.http_status,ok:ro.http_status===403});
  return{ok:checks.every(x=>x.ok),protection_version:PROTECTION_VERSION,checks};
}
