const CF_API = "https://api.cloudflare.com/client/v4";
const OR_BASE = "https://openrouter.ai/api/v1/models";
const SORTS = [
  "intelligence-high-to-low",
  "latency-low-to-high",
  "throughput-high-to-low",
  "context-high-to-low",
  "pricing-low-to-high",
  "top-weekly"
];
const MAX_LANES = 8;
const MAX_ELEMENTS_PER_ROUTE = 64;
const LOG_PAGES = 4;
const LOGS_PER_PAGE = 50;
const BANNED_COMPANIES = new Set(["openai", "anthropic", "openrouter", "aion-labs"]);
const SHARDS = {
  plan: ["research", "evidence", "synthesis", "strategy"],
  general: [],
  code: ["coding", "quantitative"],
  regulated: ["legal", "medical", "finance"],
  research: ["research", "evidence", "synthesis"],
  strategy: ["risk", "strategy", "systems", "adversarial", "forecasting"],
  creative: ["creative"]
};
const LEGACY_SLOTS = [
  ["expert-1", "1"],
  ["expert-2", "2"],
  ["expert-3", "3"],
  ["judge", "4"],
  ["governance", "5"]
];

const now = () => new Date().toISOString();
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
function fail(message, status = 500, details = null) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}
function annotate(error, phase, routeName, extra = {}) {
  error.details = { ...(error?.details || {}), phase, route_name: routeName, ...extra };
  return error;
}

function routeConfig(env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = String(env.CLOUDFLARE_AI_GATEWAY_API_TOKEN || "").trim();
  const gatewayId = String(env.AI_GATEWAY_ID || "test").trim();
  const routeName = String(env.AI_GATEWAY_ROUTE || "expert-panel-v1").trim();
  if (!accountId || !token || !gatewayId || !routeName) {
    throw fail("EXPERT_ROUTE_CONTROL_PLANE_NOT_CONFIGURED", 503, {
      account_id_configured: Boolean(accountId),
      api_token_configured: Boolean(token),
      gateway_id_configured: Boolean(gatewayId),
      route_name_configured: Boolean(routeName)
    });
  }
  const routeFamily = String(env.AI_GATEWAY_ROUTE_FAMILY || routeName.replace(/-v\d+$/i, "") || "expert-panel").trim();
  return { accountId, token, gatewayId, routeName, routeFamily };
}

function companyOf(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  return id.includes("/") ? id.split("/")[0] : "";
}
function hasTextOutput(model) {
  const output = model?.architecture?.output_modalities;
  return !Array.isArray(output) || output.length === 0 || output.includes("text");
}
function isLive(model) {
  if (!model?.expiration_date) return true;
  const timestamp = Date.parse(model.expiration_date);
  return !Number.isFinite(timestamp) || timestamp > Date.now();
}
function isSynthetic(model) {
  const text = `${model?.id || ""} ${model?.name || ""} ${model?.description || ""}`.toLowerCase();
  return /\b(auto[- ]?router|multi[- ]model|ensemble|fusion)\b/.test(text) ||
    String(model?.id || "").toLowerCase() === "openrouter/free";
}
function isFree(model) {
  const id = String(model?.id || "").toLowerCase();
  const pricing = model?.pricing || {};
  return id.includes(":free") ||
    (num(pricing.prompt) === 0 && num(pricing.completion) === 0 && num(pricing.request) === 0);
}
function eligible(model) {
  const id = String(model?.id || "").trim();
  const low = id.toLowerCase();
  const company = companyOf(id);
  const supported = Array.isArray(model?.supported_parameters) ? model.supported_parameters : [];
  if (!id || !company || BANNED_COMPANIES.has(company)) return false;
  if (low.includes("openai") || low.includes("anthropic") || low.includes("claude") || low.includes("flash")) return false;
  return supported.includes("reasoning") && hasTextOutput(model) && isLive(model) && !isSynthetic(model);
}

async function readJson(response, label) {
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; }
  catch { throw fail(`${label}_BAD_JSON`, 502, { http_status: response.status }); }
  if (!response.ok || payload?.success === false) {
    throw fail(`${label}_HTTP_ERROR`, response.status || 502, {
      errors: payload?.errors || null,
      messages: payload?.messages || null
    });
  }
  return payload;
}
async function openRouterRanking(sort) {
  const url = `${OR_BASE}?supported_parameters=reasoning&output_modalities=text&sort=${encodeURIComponent(sort)}`;
  const payload = await readJson(await fetch(url, { headers: { accept: "application/json" } }), `OPENROUTER_${sort}`);
  const models = Array.isArray(payload?.data) ? payload.data : [];
  if (!models.length) throw fail("OPENROUTER_RANKING_EMPTY", 502, { sort });
  return models;
}
function cfUrl(config, path) {
  return `${CF_API}/accounts/${encodeURIComponent(config.accountId)}/ai-gateway/gateways/${encodeURIComponent(config.gatewayId)}${path}`;
}
async function cf(config, path, { method = "GET", body, optional = false } = {}) {
  try {
    const response = await fetch(cfUrl(config, path), {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return await readJson(response, "CLOUDFLARE_API");
  } catch (error) {
    if (optional) return null;
    throw error;
  }
}
function resultData(payload) { return payload?.result ?? payload?.data ?? payload ?? null; }

async function telemetry(config) {
  const rows = [];
  for (let page = 1; page <= LOG_PAGES; page++) {
    const payload = await cf(config, `/logs?per_page=${LOGS_PER_PAGE}&page=${page}&order_by=created_at&order_by_direction=desc`, { optional: true });
    const data = resultData(payload);
    const batch = Array.isArray(data) ? data : Array.isArray(data?.logs) ? data.logs : Array.isArray(data?.data) ? data.data : [];
    rows.push(...batch);
    if (batch.length < LOGS_PER_PAGE) break;
  }
  const raw = new Map();
  for (const row of rows) {
    const model = String(row?.model || "").trim();
    if (!model) continue;
    const stat = raw.get(model) || { samples: 0, success: 0, duration: 0, cost: 0, costSamples: 0 };
    stat.samples += 1;
    if (row?.success === true) stat.success += 1;
    stat.duration += Math.max(0, num(row?.duration));
    const cost = Number(row?.cost);
    if (Number.isFinite(cost) && cost >= 0) { stat.cost += cost; stat.costSamples += 1; }
    raw.set(model, stat);
  }
  const models = new Map();
  for (const [model, stat] of raw) {
    models.set(model, {
      samples: stat.samples,
      success_rate: stat.samples ? stat.success / stat.samples : 0.5,
      avg_duration: stat.samples ? stat.duration / stat.samples : 0,
      avg_cost: stat.costSamples ? stat.cost / stat.costSamples : null
    });
  }
  return { available: rows.length > 0, sample_count: rows.length, models };
}
function rankScore(rank, count) {
  if (rank === undefined) return 0;
  return count <= 1 ? 1 : 1 - rank / (count - 1);
}
function observedScore(modelId, observed) {
  const stat = observed.models.get(modelId);
  if (!stat || stat.samples < 2) return 0.5;
  const reliability = clamp01(stat.success_rate);
  const latency = 1 / (1 + Math.max(0, stat.avg_duration) / 15000);
  const cost = stat.avg_cost == null ? 0.5 : 1 / (1 + Math.max(0, stat.avg_cost) * 100);
  const confidence = Math.min(1, stat.samples / 12);
  return 0.5 * (1 - confidence) + (0.62 * reliability + 0.28 * latency + 0.10 * cost) * confidence;
}
async function buildCatalog(config) {
  const [lists, observed] = await Promise.all([Promise.all(SORTS.map(openRouterRanking)), telemetry(config)]);
  const models = new Map();
  const ranks = Object.fromEntries(SORTS.map(sort => [sort, new Map()]));
  const sizes = {};
  SORTS.forEach((sort, index) => {
    const list = lists[index];
    sizes[sort] = list.length;
    list.forEach((model, rank) => {
      const id = String(model?.id || "");
      if (!id) return;
      if (!models.has(id) || sort === "intelligence-high-to-low") models.set(id, model);
      ranks[sort].set(id, rank);
    });
  });
  return { models: [...models.values()].filter(eligible), ranks, sizes, observed };
}
function externalScore(model, ctx, kind) {
  const rs = sort => rankScore(ctx.ranks[sort].get(model.id), ctx.sizes[sort]);
  const I = rs("intelligence-high-to-low"), L = rs("latency-low-to-high"), T = rs("throughput-high-to-low");
  const C = rs("context-high-to-low"), P = rs("pricing-low-to-high"), W = rs("top-weekly");
  if (kind === "quality") return 0.66 * I + 0.10 * C + 0.08 * W + 0.06 * L + 0.05 * T + 0.05 * P;
  if (kind === "economy") return 0.55 * I + 0.15 * L + 0.10 * T + 0.10 * W + 0.10 * P;
  return 0.45 * I + 0.15 * L + 0.15 * T + 0.10 * C + 0.08 * W + 0.07 * P;
}
function modelScore(model, ctx, kind) {
  const external = externalScore(model, ctx, kind);
  const observed = observedScore(model.id, ctx.observed);
  const weight = ctx.observed.available ? (kind === "quality" ? 0.15 : 0.22) : 0;
  return external * (1 - weight) + observed * weight;
}
function keywordBonus(model, capability) {
  const text = `${model?.id || ""} ${model?.name || ""} ${model?.description || ""}`.toLowerCase();
  const rules = {
    coding: /\b(code|coder|coding|program|developer)\b/,
    quantitative: /\b(math|mathemat|quant|reasoning|r1)\b/,
    legal: /\b(legal|law)\b/,
    medical: /\b(medical|clinical|health)\b/,
    finance: /\b(finance|financial|market)\b/,
    research: /\b(research|science|long context)\b/,
    evidence: /\b(research|analysis|reasoning)\b/,
    risk: /\b(reasoning|analysis)\b/,
    strategy: /\b(reasoning|planning|agent)\b/,
    systems: /\b(reasoning|agent|long context)\b/,
    adversarial: /\b(reasoning|thinking)\b/,
    forecasting: /\b(reasoning|analysis|forecast)\b/,
    creative: /\b(creative|writing|design|reasoning)\b/,
    synthesis: /\b(reasoning|synthesis|long context|analysis)\b/
  };
  return rules[capability]?.test(text) ? 0.12 : 0;
}
function ranked(models, ctx, kind = "balanced", filter = () => true, capabilities = []) {
  return models.filter(filter).slice().sort((a, b) => {
    const bonus = model => capabilities.reduce((sum, cap) => sum + keywordBonus(model, cap), 0);
    return (modelScore(b, ctx, kind) + bonus(b)) - (modelScore(a, ctx, kind) + bonus(a));
  });
}
function selectLanes(ctx) {
  const byCompany = new Map();
  for (const model of ctx.models) {
    const company = companyOf(model.id);
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push(model);
  }
  const companies = [...byCompany.entries()].map(([company, models]) => ({
    company,
    models,
    score: Math.max(...models.map(model => modelScore(model, ctx, "quality")))
  })).sort((a, b) => b.score - a.score).slice(0, MAX_LANES);
  if (companies.length < MAX_LANES) throw fail("INSUFFICIENT_DISTINCT_REASONING_COMPANIES", 502, { found: companies.length, required: MAX_LANES });
  return companies.map((entry, index) => ({
    lane: String(index + 1),
    company: entry.company,
    models: entry.models,
    quality: ranked(entry.models, ctx, "quality").slice(0, 3).map(model => model.id),
    balanced: ranked(entry.models, ctx, "balanced").slice(0, 3).map(model => model.id),
    free: ranked(entry.models, ctx, "economy", isFree).slice(0, 3).map(model => model.id)
  }));
}
function pickForShard(lane, ctx, shard) {
  const capabilities = SHARDS[shard] || [];
  if (!capabilities.length) return lane.balanced[0] || lane.quality[0];
  return ranked(lane.models, ctx, "quality", () => true, capabilities)[0]?.id || lane.quality[0] || lane.balanced[0];
}

function modelNode(id, model, fallback = "end") {
  return {
    id,
    type: "model",
    properties: { provider: "openrouter", model, timeout: 60000, retries: 0 },
    outputs: { success: { elementId: "end" }, fallback: { elementId: fallback || "end" } }
  };
}
function addLane(elements, lane, primaryModel, nextId, prefix) {
  const n = lane.lane;
  const reserveModel = lane.quality.find(model => model !== primaryModel) || lane.balanced.find(model => model !== primaryModel) || primaryModel;
  const reserveId = `${prefix}_m_${n}_reserve`;
  const primaryId = `${prefix}_m_${n}_primary`;
  const freeModel = lane.free[0] || null;
  const freeId = freeModel && freeModel !== primaryModel ? `${prefix}_m_${n}_free` : primaryId;
  const costId = `${prefix}_lane_${n}_cost`;
  const laneId = `${prefix}_lane_${n}`;
  elements.push(modelNode(reserveId, reserveModel, "end"));
  if (primaryModel !== reserveModel) elements.push(modelNode(primaryId, primaryModel, reserveId));
  const actualPrimaryId = primaryModel === reserveModel ? reserveId : primaryId;
  if (freeModel && freeModel !== primaryModel && freeModel !== reserveModel) elements.push(modelNode(freeId, freeModel, reserveId));
  const actualFreeId = !freeModel ? actualPrimaryId : freeModel === reserveModel ? reserveId : freeModel === primaryModel ? actualPrimaryId : freeId;
  elements.push({
    id: costId,
    type: "conditional",
    properties: { conditions: { "metadata.cost_mode": { "$eq": "free-first" } } },
    outputs: { true: { elementId: actualFreeId }, false: { elementId: actualPrimaryId } }
  });
  elements.push({
    id: laneId,
    type: "conditional",
    properties: { conditions: { "metadata.lane": { "$eq": n } } },
    outputs: { true: { elementId: costId }, false: { elementId: nextId } }
  });
  return actualPrimaryId;
}
function validateElements(elements, routeName) {
  if (!Array.isArray(elements) || !elements.length) throw fail("ROUTE_ELEMENTS_EMPTY", 500, { route_name: routeName });
  if (elements.length > MAX_ELEMENTS_PER_ROUTE) throw fail("ROUTE_ELEMENT_BUDGET_EXCEEDED", 500, { route_name: routeName, count: elements.length, max: MAX_ELEMENTS_PER_ROUTE });
  const ids = new Set();
  for (const element of elements) {
    if (!element?.id || ids.has(element.id)) throw fail("ROUTE_ELEMENT_ID_INVALID", 500, { route_name: routeName, id: element?.id || null });
    ids.add(element.id);
    if (element.type === "model" && (!element.outputs?.success?.elementId || !element.outputs?.fallback?.elementId)) {
      throw fail("ROUTE_MODEL_OUTPUT_CONTRACT_INVALID", 500, { route_name: routeName, id: element.id });
    }
  }
  const missing = [];
  for (const element of elements) for (const output of Object.values(element.outputs || {})) {
    if (output?.elementId && !ids.has(output.elementId)) missing.push([element.id, output.elementId]);
  }
  if (missing.length) throw fail("ROUTE_DANGLING_REFERENCE", 500, { route_name: routeName, missing: missing.slice(0, 10) });
  if (elements.filter(element => element.type === "start").length !== 1 || elements.filter(element => element.type === "end").length !== 1) {
    throw fail("ROUTE_TERMINAL_CONTRACT_INVALID", 500, { route_name: routeName });
  }
  return { element_count: elements.length, model_count: elements.filter(element => element.type === "model").length };
}
function buildRoute(config, lanes, ctx, { shard = "general", legacy = false } = {}) {
  const routeName = legacy ? config.routeName : `${config.routeFamily}-${shard}-v1`;
  const prefix = legacy ? "base" : shard;
  const elements = [
    { id: "start", type: "start", outputs: { next: { elementId: `${prefix}_lane_1` } } },
    { id: "end", type: "end", outputs: {} }
  ];
  const primaryTargets = {};
  for (let index = 0; index < lanes.length; index++) {
    const lane = lanes[index];
    const nextId = index < lanes.length - 1 ? `${prefix}_lane_${index + 2}` : legacy ? "legacy_expert_1" : "end";
    const primaryModel = legacy ? (lane.quality[0] || lane.balanced[0]) : pickForShard(lane, ctx, shard);
    if (!primaryModel) throw fail("LANE_HAS_NO_MODEL", 502, { route_name: routeName, lane: lane.lane, company: lane.company });
    primaryTargets[lane.lane] = addLane(elements, lane, primaryModel, nextId, prefix);
  }
  if (legacy) {
    LEGACY_SLOTS.forEach(([slot, lane], index) => {
      const id = `legacy_${slot.replace(/-/g, "_")}`;
      const next = index < LEGACY_SLOTS.length - 1 ? `legacy_${LEGACY_SLOTS[index + 1][0].replace(/-/g, "_")}` : "end";
      elements.push({
        id,
        type: "conditional",
        properties: { conditions: { "metadata.expert_slot": { "$eq": slot } } },
        outputs: { true: { elementId: primaryTargets[lane] || "end" }, false: { elementId: next } }
      });
    });
  }
  return { routeName, elements, validation: validateElements(elements, routeName), shard, legacy };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function listRoutes(payload) {
  const data = resultData(payload);
  return data?.routes || data?.data?.routes || payload?.routes || [];
}
function listVersions(payload) {
  const data = resultData(payload);
  return data?.versions || data?.data?.versions || payload?.versions || [];
}
async function findRoute(config, routeName) {
  const payload = await cf(config, "/routes?per_page=100");
  const matches = listRoutes(payload).filter(route => String(route?.name || "") === routeName);
  if (matches.length > 1) throw fail("DUPLICATE_DYNAMIC_ROUTE_NAME", 500, { route_name: routeName });
  return matches[0] || null;
}
async function newestVersionId(config, routeId) {
  const payload = await cf(config, `/routes/${encodeURIComponent(routeId)}/versions?per_page=100`);
  const versions = listVersions(payload).slice().sort((a, b) => Date.parse(b?.created_at || 0) - Date.parse(a?.created_at || 0));
  return String(versions[0]?.version_id || versions[0]?.id || "").trim();
}
async function createVersion(config, routeDef) {
  const { routeName, elements, validation } = routeDef;
  let route;
  try { route = await findRoute(config, routeName); }
  catch (error) { throw annotate(error, "find-route", routeName, validation); }
  if (!route) {
    try {
      const payload = await cf(config, "/routes", { method: "POST", body: { name: routeName, elements } });
      const data = resultData(payload);
      route = data?.route || data;
      const routeId = String(route?.id || "").trim();
      if (!routeId) throw fail("ROUTE_ID_MISSING", 502);
      const versionId = String(route?.version?.version_id || route?.version_id || "").trim() || await newestVersionId(config, routeId);
      if (!versionId) throw fail("ROUTE_VERSION_ID_MISSING", 502);
      return { routeName, routeId, versionId, previousVersionId: null, createdRoute: true, validation };
    } catch (error) { throw annotate(error, "create-route", routeName, validation); }
  }
  const routeId = String(route.id || "").trim();
  const previousVersionId = String(route?.deployment?.version_id || "").trim() || null;
  try {
    const payload = await cf(config, `/routes/${encodeURIComponent(routeId)}/versions`, { method: "POST", body: { elements } });
    const data = resultData(payload);
    const versionId = String(data?.version_id || data?.id || "").trim() || await newestVersionId(config, routeId);
    if (!versionId) throw fail("ROUTE_VERSION_ID_MISSING", 502);
    return { routeName, routeId, versionId, previousVersionId, createdRoute: false, validation };
  } catch (error) { throw annotate(error, "create-version", routeName, validation); }
}
async function verifyVersion(config, candidate) {
  try {
    const version = resultData(await cf(config, `/routes/${encodeURIComponent(candidate.routeId)}/versions/${encodeURIComponent(candidate.versionId)}`));
    if (version?.is_valid === false) throw fail("ROUTE_VERSION_INVALID", 422);
    return version;
  } catch (error) { throw annotate(error, "verify-version", candidate.routeName, candidate.validation); }
}
async function deployVersion(config, candidate, versionId = candidate.versionId) {
  try {
    return await cf(config, `/routes/${encodeURIComponent(candidate.routeId)}/deployments`, { method: "POST", body: { version_id: versionId } });
  } catch (error) { throw annotate(error, "deploy-version", candidate.routeName, candidate.validation, { version_id: versionId }); }
}
async function rollback(config, deployed) {
  const results = [];
  for (const candidate of deployed.slice().reverse()) {
    if (!candidate.previousVersionId) { results.push({ route_name: candidate.routeName, rolled_back: false, reason: "NO_PREVIOUS_VERSION" }); continue; }
    try {
      await deployVersion(config, candidate, candidate.previousVersionId);
      results.push({ route_name: candidate.routeName, rolled_back: true, version_id: candidate.previousVersionId });
    } catch (error) {
      results.push({ route_name: candidate.routeName, rolled_back: false, error: String(error?.message || error) });
    }
  }
  return results;
}

async function expertAdminContext(binding) {
  if (!binding?.fetch) return { ok: false, error: "EXPERT_BINDING_UNAVAILABLE" };
  try {
    const response = await binding.fetch(new Request("https://expert.internal/v1/admin/context", { headers: { accept: "application/json" } }));
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body?.ok === true, http_status: response.status, ...body };
  } catch (error) { return { ok: false, error: String(error?.message || "EXPERT_CONTEXT_FAILED") }; }
}
async function expertSelftest(binding) {
  if (!binding?.fetch) return { ok: false, error: "EXPERT_BINDING_UNAVAILABLE" };
  try {
    const response = await binding.fetch(new Request("https://expert.internal/v1/selftest", { method: "POST", headers: { accept: "application/json" } }));
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body?.ok === true, http_status: response.status, body };
  } catch (error) { return { ok: false, http_status: 0, error: String(error?.message || "EXPERT_SELFTEST_FAILED") }; }
}

export function routeRefreshDue(previous, env) {
  const hours = Math.max(1, Math.min(24, Number(env.EXPERT_ROUTE_REFRESH_HOURS || 6) || 6));
  if (!previous?.checked_at) return true;
  if (previous.status !== "active" && previous.status !== "unchanged") return true;
  return Date.now() - Date.parse(previous.checked_at) >= hours * 60 * 60 * 1000;
}

export async function refreshExpertRoute(env, { previous = null, expertBinding = null } = {}) {
  const config = routeConfig(env);
  const context = await expertAdminContext(expertBinding);
  if (!context.ok) return { ok: false, status: "deferred", reason: "EXPERT_CONTEXT_UNAVAILABLE", checked_at: now(), previous };
  if (context.active_task) return { ok: true, status: "deferred", reason: "EXPERT_BUSY", checked_at: now(), active_task: { task_id: context.active_task.task_id || null } };

  const catalog = await buildCatalog(config);
  const lanes = selectLanes(catalog);
  const definitions = [buildRoute(config, lanes, catalog, { legacy: true })];
  for (const shard of Object.keys(SHARDS)) definitions.push(buildRoute(config, lanes, catalog, { shard }));
  const plan = {
    schema: "adaptive-expert-route-v4-small-flow-family",
    gateway_id: config.gatewayId,
    route_family: config.routeFamily,
    ranking_signals: SORTS,
    telemetry_samples: catalog.observed.sample_count,
    routes: definitions.map(def => ({ route_name: def.routeName, shard: def.shard, legacy: def.legacy, ...def.validation })),
    lanes: lanes.map(lane => ({ lane: lane.lane, company: lane.company, quality: lane.quality, balanced: lane.balanced, free: lane.free }))
  };
  const planDigest = await sha256(plan);
  if (previous?.plan_digest === planDigest && previous?.status === "active") {
    return { ...previous, ok: true, status: "unchanged", checked_at: now(), telemetry_samples: catalog.observed.sample_count };
  }

  const candidates = [];
  for (const definition of definitions) {
    const candidate = await createVersion(config, definition);
    await verifyVersion(config, candidate);
    candidates.push(candidate);
  }
  const deployed = [];
  try {
    for (const candidate of candidates) {
      await deployVersion(config, candidate);
      deployed.push(candidate);
    }
  } catch (error) {
    const rollback_results = await rollback(config, deployed);
    throw annotate(error, "route-family-deploy", error?.details?.route_name || "unknown", { rollback_results });
  }

  const selftest = await expertSelftest(expertBinding);
  if (!selftest.ok) {
    const rollback_results = await rollback(config, deployed);
    return {
      ok: false,
      status: "rejected-rolled-back",
      checked_at: now(),
      plan_digest: planDigest,
      telemetry_samples: catalog.observed.sample_count,
      selftest: { ok: false, http_status: selftest.http_status || 0, error: selftest.error || selftest.body?.error || "SELFTEST_FAILED" },
      rollback_results,
      route_family: candidates.map(candidate => ({ route_name: candidate.routeName, route_id: candidate.routeId, candidate_version_id: candidate.versionId, previous_version_id: candidate.previousVersionId, ...candidate.validation })),
      secrets_redacted: true
    };
  }

  return {
    ok: true,
    status: "active",
    checked_at: now(),
    plan_digest: planDigest,
    telemetry_samples: catalog.observed.sample_count,
    route_family: candidates.map(candidate => ({ route_name: candidate.routeName, route_id: candidate.routeId, version_id: candidate.versionId, previous_version_id: candidate.previousVersionId, ...candidate.validation })),
    company_lanes: lanes.map(lane => ({ lane: lane.lane, company: lane.company })),
    free_lane_count: lanes.filter(lane => lane.free.length > 0).length,
    selftest: {
      ok: true,
      http_status: selftest.http_status,
      models: Array.isArray(selftest.body?.models) ? selftest.body.models : [],
      company_diverse: selftest.body?.company_diverse === true
    },
    secrets_redacted: true
  };
}
