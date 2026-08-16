export const ASSIST_POLICY_VERSION = "governance-assist-policy-v3-20260816";
export const ASSIST_VALIDATOR_VERSION = "governance-assist-validator-v3-20260816";
export const ASSIST_RUNTIME_SCHEMA = "assist-runtime-attestation-v1";

export function assistRuntimeIdentity() {
  return {
    policy_version: ASSIST_POLICY_VERSION,
    validator_version: ASSIST_VALIDATOR_VERSION,
    runtime_schema: ASSIST_RUNTIME_SCHEMA,
    runtime_attested: true,
    auxiliary_tool_access: "none",
    auxiliary_tools_allowed: false,
    auxiliary_collaboration_required: true,
    auxiliary_collaboration_scope: "every-work-item",
    auxiliary_collaboration_default: "active",
    auxiliary_controller_may_cancel: true,
    auxiliary_cancel_authority: "web-gpt-only",
    auxiliary_cancel_requires_explicit_request: true,
    auxiliary_work_item_handshake_required: true,
    auxiliary_normal_work_ai_required_unless_cancelled: true,
    auxiliary_outage_behavior: "web-gpt-degraded-fallback"
  };
}
