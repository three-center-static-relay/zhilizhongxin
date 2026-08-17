import {CAPABILITY_ABI_VERSION} from "./capability-abi.js";
import {governanceCapabilityManifest} from "./governance-capability-manifest.js";

const SERVICE = "governance-worker";
const API_VERSION = "2026-08-14";
const POLICY = {
  fail_closed: true,
  role: "governance-control-plane",
  business_secrets: false,
  arbitrary_code: false,
  github_actions_required: false,
  negative_value_changes: "deny",
  stability_first: true,
  center_isolation: true
};
const CAPABILITIES = {
  constitution: true,
  policy: true,
  center_boundaries: true,
  release_gate: true,
  source_digest: true,
  l0_constitution: true,
  capability_genome: true,
  context_compiler: true,
  task_planner: true,
  capability_composer: true,
  self_model: true,
  gap_model: true,
  entropy_governor_observe_only: true,
  autonomous_production_mutation: false,
  production_write: false
};
function json(body, status=200){ return Response.json(body,{status,headers:{"cache-control":"no-store"}}); }
async function digest(){
  const data=new TextEncoder().encode(JSON.stringify({service:SERVICE,api_version:API_VERSION,policy:POLICY,capabilities:CAPABILITIES}));
  const h=await crypto.subtle.digest("SHA-256",data);
  return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ok:true,status:"ready",service:SERVICE,api_version:API_VERSION,source:"github-static-relay"});
    if (request.method === "GET" && (url.pathname === "/v1/policy" || url.pathname === "/policy")) return json({ok:true,service:SERVICE,policy:POLICY});
    if (request.method === "GET" && (url.pathname === "/v1/capabilities" || url.pathname === "/capabilities")) return json({ok:true,service:SERVICE,capabilities:CAPABILITIES,capability_abi_version:CAPABILITY_ABI_VERSION,capability_manifest:governanceCapabilityManifest()});
    if (request.method === "GET" && (url.pathname === "/v1/quota" || url.pathname === "/quota")) return json({ok:true,production_write:false,secret_storage:false});
    if (request.method === "GET" && url.pathname === "/source") return json({ok:true,service:SERVICE,api_version:API_VERSION,source_digest:await digest(),secrets_redacted:true});
    if (request.method === "GET" && url.pathname === "/v1/acceptance/latest") return json({ok:true,service:SERVICE,status:"not_verified",run_id:null,receipt_digest:null});
    if (request.method === "GET" && url.pathname === "/openapi.json") return json({openapi:"3.1.0",info:{title:"Governance Center",version:API_VERSION},paths:{"/health":{get:{}},"/v1/policy":{get:{}},"/v1/capabilities":{get:{}}}});
    return json({ok:false,error:"POLICY_DENIED",message:"Governance worker is read-only from this interface"},403);
  }
};
