import { runAssist } from "./assist.js";
import { assistRuntimeIdentity } from "./assist-runtime.js";

function withRuntimeHeaders(headers = new Headers()) {
  const runtime = assistRuntimeIdentity();
  const out = new Headers(headers);
  out.set("cache-control", "no-store");
  out.set("x-governance-policy-version", runtime.policy_version);
  out.set("x-governance-validator-version", runtime.validator_version);
  out.set("x-governance-runtime-schema", runtime.runtime_schema);
  out.set("x-governance-runtime-attested", String(runtime.runtime_attested));
  return out;
}

export function runtimeSelftestResponse() {
  const runtime = assistRuntimeIdentity();
  return Response.json({
    ok: true,
    selftest: "runtime-attestation",
    ai_called: false,
    cost_incurred: false,
    ...runtime
  }, {
    status: 200,
    headers: withRuntimeHeaders()
  });
}

export async function runAttestedAssist(request, env) {
  const response = await runAssist(request, env);
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object") {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: withRuntimeHeaders(response.headers)
    });
  }

  return Response.json({ ...body, ...assistRuntimeIdentity() }, {
    status: response.status,
    headers: withRuntimeHeaders(response.headers)
  });
}
