import { WorkerEntrypoint } from "cloudflare:workers";
import maintenance, { MaintenanceState } from "./index.js";

export { MaintenanceState };
export default maintenance;

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const JSON_HEADERS = {"content-type":"application/json;charset=utf-8","cache-control":"no-store"};
const versionId = env => String(env.CF_VERSION_METADATA?.id || "").trim() || null;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });

function authorizeControl(ctx) {
  const props = ctx?.props || {};
  if (props.caller !== "admin-worker" || props.capability !== "expert-route-refresh") {
    throw new Error("RPC_CALLER_NOT_AUTHORIZED");
  }
}

function requestId(value) {
  const id = String(value || "").trim();
  if (!REQUEST_ID.test(id)) throw new Error("INVALID_REQUEST_ID");
  return id;
}

async function readJson(response) {
  return await response.json().catch(() => null);
}

async function runRefresh(env, ctx, value, transport) {
  const id = requestId(value);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const triggerId = `${transport}:${id}`;
  const controlEnv = {
    ...env,
    IMMEDIATE_REFRESH_ENABLED: "true",
    IMMEDIATE_REFRESH_ID: triggerId,
    IMMEDIATE_REFRESH_NONCE: nonce,
  };
  const response = await maintenance.fetch(new Request("https://maintenance.internal/v1/maintenance/refresh-now", {
    method: "POST",
    headers: {
      accept: "application/json",
      "x-immediate-refresh-nonce": nonce,
    },
  }), controlEnv, ctx);
  const body = await readJson(response);
  return {
    ok: response.ok && body?.ok === true,
    http_status: response.status,
    request_id: id,
    transport,
    maintenance_version: versionId(env),
    result: body?.result || null,
    error: body?.error || null,
    secrets_redacted: true,
  };
}

async function latestRoute(env, ctx, transport) {
  const response = await maintenance.fetch(new Request("https://maintenance.internal/v1/maintenance/expert-route/latest", {
    method: "GET",
    headers: { accept: "application/json" },
  }), env, ctx);
  const body = await readJson(response);
  return {
    ok: response.ok && body?.ok === true,
    http_status: response.status,
    transport,
    maintenance_version: versionId(env),
    expert_route: body?.expert_route || null,
    error: body?.error || null,
    secrets_redacted: true,
  };
}

export class MaintenanceControl extends WorkerEntrypoint {
  async fetch(request) {
    authorizeControl(this.ctx);
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/control/expert-route/refresh") {
      const body = await request.json().catch(() => ({}));
      try {
        const receipt = await runRefresh(this.env, this.ctx, body.request_id, "fetch");
        return json(receipt, receipt.ok ? 200 : receipt.http_status === 409 ? 409 : 502);
      } catch (error) {
        return json({ok:false,error:String(error?.message||error),transport:"fetch",maintenance_version:versionId(this.env),secrets_redacted:true},400);
      }
    }
    if (request.method === "GET" && url.pathname === "/v1/control/expert-route/latest") {
      const receipt = await latestRoute(this.env, this.ctx, "fetch");
      return json(receipt, receipt.ok ? 200 : 502);
    }
    return json({ok:false,error:"NOT_FOUND",secrets_redacted:true},404);
  }

  async refreshExpertRoute(value) {
    authorizeControl(this.ctx);
    return await runRefresh(this.env, this.ctx, value, "rpc");
  }

  async latestExpertRoute() {
    authorizeControl(this.ctx);
    return await latestRoute(this.env, this.ctx, "rpc");
  }
}
