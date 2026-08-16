import { runAssist } from "./assist.js";
import { validateModelContent } from "./assist-policy.js";
import { assistRuntimeIdentity } from "./assist-runtime.js";

const SELFTEST_RUNTIME_ATTESTATION = "__SELFTEST_RUNTIME_ATTESTATION__";
const SELFTEST_FINAL_VALIDATOR = "__SELFTEST_FINAL_VALIDATOR__";

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

function attestedJson(body, status = 200) {
  return Response.json({ ...body, http_status: status, ...assistRuntimeIdentity() }, {
    status,
    headers: withRuntimeHeaders()
  });
}

function constantTimeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authenticateController(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return { ok: false, status: 401, error: "UNAUTHORIZED" };
  if (!env.ADMIN_GPT_TOKEN) return { ok: false, status: 503, error: "ADMIN_TOKEN_NOT_CONFIGURED" };
  const token = authorization.slice(7).trim();
  if (!constantTimeEqual(token, env.ADMIN_GPT_TOKEN)) return { ok: false, status: 401, error: "UNAUTHORIZED" };
  return { ok: true };
}

export function runtimeSelftestResponse() {
  return attestedJson({
    ok: true,
    selftest: "runtime-attestation",
    ai_called: false,
    cost_incurred: false
  });
}

function finalValidatorSelftestResponse() {
  const checks = [];
  const reject = (name, prompt, content, expected) => {
    try {
      validateModelContent(prompt, {}, content);
      checks.push({ name, ok: false, expected, observed: "ACCEPTED" });
    } catch (error) {
      const observed = String(error?.message || error);
      checks.push({ name, ok: observed === expected, expected, observed });
    }
  };

  reject(
    "active-e2e-degraded-rejected",
    "新版本已经部署生产，真实业务 E2E 失败。请给出总体状态。",
    "整体系统状态：DEGRADED。失败版本必须立即回滚。",
    "NONCOMPLIANT_E2E_STATE_OUTPUT"
  );
  reject(
    "http-503-rescue-rejected",
    "HTTP 503 但响应体里有完整正文，如何判断？",
    "需看输出契约，不直接成功。",
    "NONCOMPLIANT_NON2XX_OUTPUT"
  );
  reject(
    "unverified-profile-pass-rejected",
    "代码声明 high-reasoning Profile，但没有生产运行时回执或 metadata。请自评。",
    "高推理 Profile：PASS",
    "UNVERIFIED_RUNTIME_PROFILE_PASS"
  );
  reject(
    "unverified-redteam-claim-rejected",
    "请审查答卷；当前没有红队工具回执或调用记录。",
    "红队审查支持该判断：失败版本必须回滚。",
    "UNVERIFIED_EXECUTION_CLAIM"
  );

  let compliantAccepted = false;
  try {
    validateModelContent(
      "新版本已经部署生产，真实业务 E2E 失败。请给出总体状态。",
      {},
      "整体系统状态：FAIL-CLOSED。失败版本必须立即回滚到最近一个已验证稳定版本。"
    );
    compliantAccepted = true;
  } catch {}
  checks.push({ name: "compliant-output-accepted", ok: compliantAccepted, expected: "ACCEPTED", observed: compliantAccepted ? "ACCEPTED" : "REJECTED" });

  const ok = checks.every(item => item.ok);
  return attestedJson({
    ok,
    selftest: "final-validator",
    ai_called: false,
    cost_incurred: false,
    validation: ok ? "PASS" : "FAIL",
    checks
  }, ok ? 200 : 500);
}

async function compatibilitySelftest(request) {
  const body = await request.clone().json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (prompt === SELFTEST_RUNTIME_ATTESTATION) return runtimeSelftestResponse();
  if (prompt === SELFTEST_FINAL_VALIDATOR) return finalValidatorSelftestResponse();
  return null;
}

async function controllerCollaborationOverride(request, env) {
  const body = await request.clone().json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  const mode = body.auxiliary_mode === undefined ? "active" : String(body.auxiliary_mode || "").trim();
  if (mode === "active") return null;

  const auth = authenticateController(request, env);
  if (!auth.ok) return attestedJson({ ok: false, error: auth.error }, auth.status);

  if (mode !== "cancel") {
    return attestedJson({
      ok: false,
      error: "INVALID_AUXILIARY_MODE",
      message: "auxiliary_mode must be active or cancel"
    }, 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return attestedJson({ ok: false, error: "INVALID_REQUEST", message: "prompt required" }, 400);
  }

  const cancelReason = typeof body.cancel_reason === "string" && body.cancel_reason.trim()
    ? body.cancel_reason.trim().slice(0, 500)
    : null;

  return attestedJson({
    ok: true,
    provider: "governance-collaboration-control",
    selection: "explicit-controller-cancel",
    model: null,
    content: "Auxiliary model collaboration was explicitly cancelled by the controlling web GPT for this work item.",
    usage: null,
    attempts: [],
    ai_called: false,
    cost_incurred: false,
    auxiliary_called: false,
    collaboration_required: true,
    collaboration_default: "active",
    collaboration_status: "cancelled-by-controller",
    collaboration_cancel_authority: "web-gpt-only",
    collaboration_cancel_explicit: true,
    cancel_reason: cancelReason
  });
}

export async function runAttestedAssist(request, env) {
  const compatibility = await compatibilitySelftest(request);
  if (compatibility) return compatibility;

  const override = await controllerCollaborationOverride(request, env);
  if (override) return override;

  const response = await runAssist(request, env);
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object") {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: withRuntimeHeaders(response.headers)
    });
  }

  return Response.json({ ...body, http_status: response.status, ...assistRuntimeIdentity() }, {
    status: response.status,
    headers: withRuntimeHeaders(response.headers)
  });
}
