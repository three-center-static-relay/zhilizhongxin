import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assistRoutingInfo } from "../src/assist.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "src/assist.js"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8"));
const gateway = assistRoutingInfo().cloudflare.gateway;

assert.equal(config.ai.binding, "AI");
assert.equal(config.vars.AI_GATEWAY_ID, "four-center-ai-gateway");
assert.match(source, /env\.AI\.run\(model, workersAiParameters\(model, messages, maxTokens\), \{/);
assert.match(source, /skipCache: true/);
assert.match(source, /collectLog: false/);
assert.deepEqual(gateway, {
  id_from: "AI_GATEWAY_ID",
  default_id: "four-center-ai-gateway",
  binding_authenticated: true,
  cache: false,
  request_logging: false
});

console.log(JSON.stringify({
  ok: true,
  suite: "governance-ai-gateway-contract",
  provider: "workers-ai",
  binding_authenticated: true,
  cache: false,
  request_logging: false
}));
