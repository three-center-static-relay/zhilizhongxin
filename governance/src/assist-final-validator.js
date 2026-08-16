import { validateModelContent } from "./assist-policy.js";
import { assistRuntimeIdentity } from "./assist-runtime.js";

const MAX_BODY_BYTES = 65536;
const json = (body, status = 200) => Response.json({ ...body, http_status: status }, { status, headers: { "cache-control": "no-store" } });

function constantTimeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authenticate(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return { ok: false, status: 401, error: "UNAUTHORIZED" };
  if (!env.ADMIN_GPT_TOKEN) return { ok: false, status: 503, error: "ADMIN_TOKEN_NOT_CONFIGURED" };
  const token = authorization.slice(7).trim();
  if (!constantTimeEqual(token, env.ADMIN_GPT_TOKEN)) return { ok: false, status: 401, error: "UNAUTHORIZED" };
  return { ok: true };
}

async function parseBody(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 });
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("INVALID_REQUEST"), { status: 400 }); }
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

export async function runFinalAssistValidation(request, env) {
  const auth = authenticate(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error, ...assistRuntimeIdentity() }, auth.status);

  try {
    const body = await parseBody(request);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!prompt || !content) {
      return json({ ok: false, error: "INVALID_REQUEST", message: "prompt and content required", ...assistRuntimeIdentity() }, 400);
    }

    try {
      validateModelContent(prompt, body.output && typeof body.output === "object" ? body.output : {}, content);
      return json({
        ok: true,
        validation: "PASS",
        final_output_validated: true,
        content_sha256: await sha256(content),
        prompt_sha256: await sha256(prompt),
        ...assistRuntimeIdentity()
      });
    } catch (error) {
      return json({
        ok: false,
        validation: "FAIL",
        final_output_validated: false,
        error: "FINAL_OUTPUT_POLICY_REJECTED",
        validation_error: String(error?.message || error),
        content_sha256: await sha256(content),
        prompt_sha256: await sha256(prompt),
        ...assistRuntimeIdentity()
      }, 422);
    }
  } catch (error) {
    return json({ ok: false, error: String(error?.message || "INTERNAL_ERROR"), ...assistRuntimeIdentity() }, error?.status || 500);
  }
}
