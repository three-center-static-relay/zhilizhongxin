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
const CAPABILITIES = [
  "coding","quantitative","legal","medical","finance","research","risk",
  "evidence","strategy","systems","adversarial","forecasting","creative","synthesis"
];
const MAX_LANES = 8;
const LOG_PAGES = 4;
const LOGS_PER_PAGE = 50;
const BANNED_COMPANIES = new Set(["openai","anthropic","openrouter","aion-labs"]);

const now = () => new Date().toISOString();
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

function routeConfig(env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = String(env.CLOUDFLARE_AI_GATEWAY_API_TOKEN || "").trim();
  const gatewayId = String(env.AI_GATEWAY_ID || "test").trim();
  const routeName = String(env.AI_GATEWAY_ROUTE || "expert-panel-v1").trim();
  if (!accountId || !token || !gatewayId || !routeName) {
    const error = new Error("EXPERT_ROUTE_CONTROL_PLANE_NOT_CONFIGURED");
    error.status = 503;
    error.details = {
      account_id_configured: Boolean(accountId),
      api_token_configured: Boolean(token),
      gateway_id_configured: Boolean(gatewayId),
      route_name_configured: Boolean(routeName)
    };
    throw error;
  }
  return { accountId, token, gatewayId, routeName };
}

function companyOf(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  return id.includes("/") ? id.split("/")[0] : "";
}

function hasTextOutput(model) {
  const out = model?.architecture?.output_modalities;
  return !Array.isArray(out) || out.length === 0 || out.includes("text");
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
  if (!supported.includes("reasoning") || !hasTextOutput(model) || !isLive(model) || isSynthetic(model)) return false;
  return true;
}

async function readJson(response, label) {
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; }
  catch {
    const error = new Error(`${label}_BAD_JSON`);
    error.status = 502;
    throw error;
  }
  if (!response.ok || payload?.success === false) {
    const error = new Error(`${label}_HTTP_ERROR`);
    error.status = response.status || 502;
    error.details = { errors: payload?.errors || null, messages: payload?.messages || null };
    throw error;
  }
  return payload;
}

async function openRouterRanking(sort) {
  const url = `${OR_BASE}?supported_parameters=reasoning&output_modalities=text&sort=${encodeURIComponent(sort)}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const payload = await readJson(response, `OPENROUTER_${sort}`);
  const models = Array.isArray(payload?.data) ? payload.data : [];
  if (!models.length) throw Object.assign(new Error("OPENROUTER_RANKING_EMPTY"), { status: 502, details: { sort } });
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

async function telemetry(config) {
  const rows = [];
  for (let page = 1; page <= LOG_PAGES; page++) {
    const payload = await cf(
      config,
      `/logs?per_page=${LOGS_PER_PAGE}&page=${page}&order_by=created_at&order_by_direction=desc`,
      { optional: true }
    );
    const batch = Array.isArray(payload?.result) ? payload.result : [];
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
    const duration = num(row?.duration);
    if (duration >= 0) stat.duration += duration;
    const cost = Number(row?.cost);
    if (Number.isFinite(cost) && cost >= 0) {
      stat.cost += cost;
      stat.costSamples += 1;
    }
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
  const score = 0.62 * reliability + 0.28 * latency + 0.10 * cost;
  return 0.5 * (1 - confidence) + score * confidence;
}

async function buildCatalog(config) {
  const [lists, observed] = await Promise.all([
    Promise.all(SORTS.map(openRouterRanking)),
    telemetry(config)
  ]);
  const models = new Map();
  const ranks = Object.fromEntries(SORTS.map(sort => [sort, new Map()]));
  const sizes = {};
  for (let i = 0; i < SORTS.length; i++) {
    const sort = SORTS[i];
    const list = lists[i];
    sizes[sort] = list.length;
    list.forEach((model, rank) => {
      const id = String(model?.id || "");
      if (!id) return;
      if (!models.has(id) || sort === "intelligence-high-to-low") models.set(id, model);
      ranks[sort].set(id, rank);
    });
  }
  return { models: [...models.values()].filter(eligible), ranks, sizes, observed };
}

function externalScore(model, ctx, kind) {
  const id = model.id;
  const rs = sort => rankScore(ctx.ranks[sort].get(id), ctx.sizes[sort]);
  const I = rs("intelligence-high-to-low");
  const L = rs("latency-low-to-high");
  const T = rs("throughput-high-to-low");
  const C = rs("context-high-to-low");
  const P = rs("pricing-low-to-high");
  const W = rs("top-weekly");
  if (kind === "quality") return 0.66 * I + 0.10 * C + 0.08 * W + 0.06 * L + 0.05 * T + 0.05 * P;
  if (kind === "fast") return 0.38 * I + 0.28 * L + 0.24 * T + 0.05 * W + 0.05 * P;
  if (kind === "economy") return 0.55 * I + 0.15 * L + 0.10 * T + 0.10 * W + 0.10 * P;
  return 0.45 * I + 0.15 * L + 0.15 * T + 0.10 * C + 0.08 * W + 0.07 * P;
}

function modelScore(model, ctx, kind) {
  const external = externalScore(model, ctx, kind);
  const observed = observedScore(model.id, ctx.observed);
  const observedWeight = ctx.observed.available ? (kind === "quality" ? 0.15 : kind === "fast" ? 0.30 : 0.22) : 0;
  return external * (1 - observedWeight) + observed * observedWeight;
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
    risk: /\b(reasoning|analysis)\b/,
    evidence: /\b(reasoning|research|analysis)\b/,
    strategy: /\b(reasoning|planning|agent)\b/,
    systems: /\b(reasoning|agent|long context)\b/,
    adversarial: /\b(reasoning|thinking)\b/,
    forecasting: /\b(reasoning|analysis|forecast)\b/,
    creative: /\b(creative|writing|design|reasoning)\b/,
    synthesis: /\b(reasoning|synthesis|long context|analysis)\b/
  };
  return rules[capability]?.test(text) ? 0.12 : 0;
}

function ranked(models, ctx, kind = "balanced", filter = () => true, capability = null) {
  return models.filter(filter).slice().sort((a, b) =>
    (modelScore(b, ctx, kind) + (capability ? keywordBonus(b, capability) : 0)) -
    (modelScore(a, ctx, kind) + (capability ? keywordBonus(a, capability) : 0))
  );
}

function selectLanes(ctx) {
  const byCompany = new Map();
  for (const model of ctx.models) {
    const company = companyOf(model.id);
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push(model);
  }
  const companies = [...byCompany.entries()]
    .map(([company, models]) => ({
      company,
      models,
      companyScore: Math.max(...models.map(model => modelScore(model, ctx, "quality")))
    }))
    .sort((a, b) => b.companyScore - a.companyScore)
    .slice(0, MAX_LANES);
  if (companies.length < MAX_LANES) {
    throw Object.assign(new Error("INSUFFICIENT_DISTINCT_REASONING_COMPANIES"), {
      status: 502,
      details: { found: companies.length, required: MAX_LANES }
    });
  }
  return companies.map((entry, index) => {
    const quality = ranked(entry.models, ctx, "quality");
    const balanced = ranked(entry.models, ctx, "balanced");
    const free = ranked(entry.models, ctx, "economy", isFree);
    const fast = ranked(entry.models, ctx, "fast");
    const special = {};
    for (const capability of CAPABILITIES) {
      special[capability] = ranked(entry.models, ctx, "quality", () => true, capability).slice(0, 3).map(model => model.id);
    }
    return {
      lane: String(index + 1),
      company: entry.company,
      quality: quality.slice(0, 3).map(model => model.id),
      balanced: balanced.slice(0, 3).map(model => model.id),
      free: free.slice(0, 3).map(model => model.id),
      fast: fast.slice(0, 3).map(model => model.id),
      special
    };
  });
}

function modelNode(id, model, success = "end", fallback = null) {
  const outputs = { success: { elementId: success } };
  if (fallback) outputs.fallback = { elementId: fallback };
  return { id, type: "model", properties: { provider: "openrouter", model, timeout: 60000, retries: 0 }, outputs };
}

function addModelChain(elements, prefix, modelIds) {
  const unique = [...new Set(modelIds.filter(Boolean))];
  if (!unique.length) return null;
  const nodeIds = unique.map((_, index) => `${prefix}_${index + 1}`);
  unique.forEach((model, index) => elements.push(modelNode(nodeIds[index], model, "end", nodeIds[index + 1] || null)));
  return nodeIds[0];
}

function addCapabilityChain(elements, laneNumber, lane, defaultTarget) {
  let next = defaultTarget;
  for (let index = CAPABILITIES.length - 1; index >= 0; index--) {
    const capability = CAPABILITIES[index];
    const safe = capability.replace(/-/g, "_");
    const target = addModelChain(
      elements,
      `m_${laneNumber}_cap_${safe}`,
      [...(lane.special[capability] || []), ...lane.quality, ...lane.balanced, ...lane.free]
    ) || defaultTarget;
    const id = `lane_${laneNumber}_cap_${safe}`;
    elements.push({
      id,
      type: "conditional",
      properties: { conditions: { "metadata.capability": { "$eq": capability } } },
      outputs: { true: { elementId: target }, false: { elementId: next } }
    });
    next = id;
  }
  return next;
}

function buildElements(lanes) {
  const elements = [
    { id: "start", type: "start", outputs: { next: { elementId: "lane_1" } } },
    { id: "end", type: "end", outputs: {} }
  ];
  for (let index = 0; index < lanes.length; index++) {
    const lane = lanes[index];
    const n = lane.lane;
    const nextLane = index < lanes.length - 1 ? `lane_${index + 2}` : "end";
    const qualityTarget = addModelChain(elements, `m_${n}_quality`, [...lane.quality, ...lane.balanced, ...lane.free]);
    const balancedTarget = addModelChain(elements, `m_${n}_balanced`, [...lane.balanced, ...lane.quality, ...lane.free]);
    const freeTarget = addModelChain(elements, `m_${n}_free`, [...lane.free, ...lane.balanced, ...lane.quality]) || balancedTarget;
    const fastTarget = addModelChain(elements, `m_${n}_fast`, [...lane.fast, ...lane.balanced, ...lane.quality, ...lane.free]) || balancedTarget;
    const capabilityRoot = addCapabilityChain(elements, n, lane, balancedTarget);
    const root = `lane_${n}`;
    const free = `lane_${n}_free`;
    const quality = `lane_${n}_quality`;
    const stage = `lane_${n}_stage`;
    const depth = `lane_${n}_depth`;
    const speed = `lane_${n}_speed`;

    elements.push({
      id: root,
      type: "conditional",
      properties: { conditions: { "metadata.lane": { "$eq": n } } },
      outputs: { true: { elementId: free }, false: { elementId: nextLane } }
    });
    elements.push({
      id: free,
      type: "conditional",
      properties: { conditions: { "metadata.cost_mode": { "$eq": "free-first" } } },
      outputs: { true: { elementId: freeTarget }, false: { elementId: quality } }
    });
    elements.push({
      id: quality,
      type: "conditional",
      properties: { conditions: { "metadata.cost_mode": { "$eq": "quality-first" } } },
      outputs: { true: { elementId: qualityTarget }, false: { elementId: stage } }
    });
    elements.push({
      id: stage,
      type: "conditional",
      properties: { conditions: { "metadata.stage": { "$in": ["planner", "judge", "meta-judge", "governance"] } } },
      outputs: { true: { elementId: qualityTarget }, false: { elementId: depth } }
    });
    elements.push({
      id: depth,
      type: "conditional",
      properties: { conditions: { "metadata.depth": { "$eq": "deep" } } },
      outputs: { true: { elementId: qualityTarget }, false: { elementId: speed } }
    });
    elements.push({
      id: speed,
      type: "conditional",
      properties: { conditions: { "metadata.capability": { "$eq": "fast" } } },
      outputs: { true: { elementId: fastTarget }, false: { elementId: capabilityRoot } }
    });
  }
  return elements;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function listRoutes(payload) {
  return payload?.result?.routes || payload?.result?.data?.routes || payload?.data?.routes || payload?.routes || [];
}

function listVersions(payload) {
  return payload?.result?.versions || payload?.result?.data?.versions || payload?.data?.versions || payload?.versions || [];
}

async function findRoute(config) {
  const payload = await cf(config, "/routes?per_page=100");
  const matches = listRoutes(payload).filter(route => String(route?.name || "") === config.routeName);
  if (matches.length > 1) throw Object.assign(new Error("DUPLICATE_DYNAMIC_ROUTE_NAME"), { status: 500 });
  return matches[0] || null;
}

async function newestVersionId(config, routeId) {
  const payload = await cf(config, `/routes/${encodeURIComponent(routeId)}/versions?per_page=100`);
  const versions = listVersions(payload).slice().sort((a, b) => Date.parse(b?.created_at || 0) - Date.parse(a?.created_at || 0));
  return String(versions[0]?.version_id || versions[0]?.id || "").trim();
}

async function createVersion(config, elements) {
  let route = await findRoute(config);
  if (!route) {
    const payload = await cf(config, "/routes", { method: "POST", body: { name: config.routeName, elements } });
    route = payload?.result?.route || payload?.result || payload?.route || null;
    const routeId = String(route?.id || "").trim();
    if (!routeId) throw Object.assign(new Error("ROUTE_ID_MISSING"), { status: 502 });
    const versionId = String(route?.version?.version_id || route?.version_id || "").trim() || await newestVersionId(config, routeId);
    if (!versionId) throw Object.assign(new Error("ROUTE_VERSION_ID_MISSING"), { status: 502 });
    return { routeId, versionId, previousVersionId: null, createdRoute: true };
  }
  const routeId = String(route.id || "").trim();
  const previousVersionId = String(route?.deployment?.version_id || "").trim() || null;
  const payload = await cf(config, `/routes/${encodeURIComponent(routeId)}/versions`, { method: "POST", body: { elements } });
  const versionId = String(payload?.result?.version_id || payload?.result?.id || payload?.version_id || payload?.id || "").trim() || await newestVersionId(config, routeId);
  if (!versionId) throw Object.assign(new Error("ROUTE_VERSION_ID_MISSING"), { status: 502 });
  return { routeId, versionId, previousVersionId, createdRoute: false };
}

async function verifyVersion(config, routeId, versionId) {
  const payload = await cf(config, `/routes/${encodeURIComponent(routeId)}/versions/${encodeURIComponent(versionId)}`);
  const version = payload?.result || payload;
  if (version?.is_valid === false) throw Object.assign(new Error("ROUTE_VERSION_INVALID"), { status: 422 });
  return version;
}

async function deployVersion(config, routeId, versionId) {
  return cf(config, `/routes/${encodeURIComponent(routeId)}/deployments`, { method: "POST", body: { version_id: versionId } });
}

async function expertAdminContext(expertBinding) {
  if (!expertBinding?.fetch) return { ok: false, error: "EXPERT_BINDING_UNAVAILABLE" };
  try {
    const response = await expertBinding.fetch(new Request("https://expert.internal/v1/admin/context", { method: "GET", headers: { accept: "application/json" } }));
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body?.ok === true, http_status: response.status, ...body };
  } catch (error) {
    return { ok: false, error: String(error?.message || "EXPERT_CONTEXT_FAILED") };
  }
}

async function expertSelftest(expertBinding) {
  if (!expertBinding?.fetch) return { ok: false, error: "EXPERT_BINDING_UNAVAILABLE" };
  try {
    const response = await expertBinding.fetch(new Request("https://expert.internal/v1/selftest", { method: "POST", headers: { accept: "application/json" } }));
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body?.ok === true, http_status: response.status, body };
  } catch (error) {
    return { ok: false, http_status: 0, error: String(error?.message || "EXPERT_SELFTEST_FAILED") };
  }
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
  if (!context.ok) {
    return { ok: false, status: "deferred", reason: "EXPERT_CONTEXT_UNAVAILABLE", checked_at: now(), previous };
  }
  if (context.active_task) {
    return { ok: true, status: "deferred", reason: "EXPERT_BUSY", checked_at: now(), active_task: { task_id: context.active_task.task_id || null } };
  }

  const catalog = await buildCatalog(config);
  const lanes = selectLanes(catalog);
  const elements = buildElements(lanes);
  const plan = {
    schema: "adaptive-expert-route-v3",
    gateway_id: config.gatewayId,
    route_name: config.routeName,
    ranking_signals: SORTS,
    telemetry_samples: catalog.observed.sample_count,
    lanes: lanes.map(lane => ({
      lane: lane.lane,
      company: lane.company,
      quality: lane.quality,
      balanced: lane.balanced,
      free: lane.free,
      fast: lane.fast,
      special: lane.special
    }))
  };
  const planDigest = await sha256(plan);
  if (previous?.plan_digest === planDigest && previous?.status === "active") {
    return {
      ...previous,
      ok: true,
      status: "unchanged",
      checked_at: now(),
      telemetry_samples: catalog.observed.sample_count
    };
  }

  const version = await createVersion(config, elements);
  await verifyVersion(config, version.routeId, version.versionId);
  await deployVersion(config, version.routeId, version.versionId);
  const selftest = await expertSelftest(expertBinding);
  if (!selftest.ok) {
    let rolledBack = false;
    let rollbackError = null;
    if (version.previousVersionId) {
      try {
        await deployVersion(config, version.routeId, version.previousVersionId);
        rolledBack = true;
      } catch (error) {
        rollbackError = String(error?.message || error);
      }
    }
    return {
      ok: false,
      status: rolledBack ? "rejected-rolled-back" : "rejected-no-rollback",
      checked_at: now(),
      route_id: version.routeId,
      candidate_version_id: version.versionId,
      previous_version_id: version.previousVersionId,
      plan_digest: planDigest,
      telemetry_samples: catalog.observed.sample_count,
      selftest: { ok: false, http_status: selftest.http_status || 0, error: selftest.error || selftest.body?.error || "SELFTEST_FAILED" },
      rolled_back: rolledBack,
      rollback_error: rollbackError
    };
  }

  return {
    ok: true,
    status: "active",
    checked_at: now(),
    route_id: version.routeId,
    version_id: version.versionId,
    previous_version_id: version.previousVersionId,
    plan_digest: planDigest,
    telemetry_samples: catalog.observed.sample_count,
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
