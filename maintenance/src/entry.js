import { WorkerEntrypoint } from "cloudflare:workers";
import maintenance, { MaintenanceState } from "./index.js";

export { MaintenanceState };
export default maintenance;

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

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

export class MaintenanceControl extends WorkerEntrypoint {
  async refreshExpertRoute(value) {
    authorizeControl(this.ctx);
    const id = requestId(value);
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const triggerId = `rpc:${id}`;
    const rpcEnv = {
      ...this.env,
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
    }), rpcEnv, this.ctx);
    const body = await readJson(response);
    return {
      ok: response.ok && body?.ok === true,
      http_status: response.status,
      request_id: id,
      result: body?.result || null,
      error: body?.error || null,
      secrets_redacted: true,
    };
  }

  async latestExpertRoute() {
    authorizeControl(this.ctx);
    const response = await maintenance.fetch(new Request("https://maintenance.internal/v1/maintenance/expert-route/latest", {
      method: "GET",
      headers: { accept: "application/json" },
    }), this.env, this.ctx);
    const body = await readJson(response);
    return {
      ok: response.ok && body?.ok === true,
      http_status: response.status,
      expert_route: body?.expert_route || null,
      error: body?.error || null,
      secrets_redacted: true,
    };
  }
}
