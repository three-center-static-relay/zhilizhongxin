export const ASSIST_POLICY_VERSION = "governance-assist-policy-v3-20260816";
export const ASSIST_VALIDATOR_VERSION = "governance-assist-validator-v3-20260816";
export const ASSIST_RUNTIME_SCHEMA = "assist-runtime-attestation-v1";

export function assistRuntimeIdentity() {
  return {
    policy_version: ASSIST_POLICY_VERSION,
    validator_version: ASSIST_VALIDATOR_VERSION,
    runtime_schema: ASSIST_RUNTIME_SCHEMA,
    runtime_attested: true
  };
}
