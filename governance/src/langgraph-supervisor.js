import { Annotation, StateGraph, START, END } from "@langchain/langgraph/web";
import { buildSelfModel, collectCapabilityManifests, compileTaskPlan } from "./evolution-kernel.js";

export const LANGGRAPH_SUPERVISOR_RUNTIME = "@langchain/langgraph@1.4.10";

const SupervisorState = Annotation.Root({
  task: Annotation(),
  discovery: Annotation(),
  self_model: Annotation(),
  plan: Annotation(),
  validation: Annotation(),
  status: Annotation(),
  error: Annotation(),
  trace: Annotation({
    reducer: (left, right) => [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])],
    default: () => []
  })
});

const ProbeState = Annotation.Root({
  status: Annotation(),
  trace: Annotation({
    reducer: (left, right) => [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])],
    default: () => []
  })
});

function validateSupervisorPlan(plan) {
  const nodes = Array.isArray(plan?.graph?.nodes) ? plan.graph.nodes : [];
  const allowedCenters = new Set(["governance", "intelligence", "compute", "expert"]);
  const invalidCenter = nodes.find((node) => !allowedCenters.has(String(node?.center || "")));
  const safe = plan?.ok === true
    && plan?.execution_started === false
    && plan?.side_effects_started === false
    && plan?.production_mutation === false
    && !invalidCenter;
  return {
    ok: safe,
    fail_closed: true,
    invalid_center: invalidCenter?.center || null,
    production_mutation: false,
    execution_started: false
  };
}

function buildSupervisorGraph(env) {
  return new StateGraph(SupervisorState)
    .addNode("discover", async () => {
      const discovery = await collectCapabilityManifests(env);
      const selfModel = buildSelfModel(discovery.manifests || []);
      return {
        discovery: {
          ok: discovery.ok === true,
          status: discovery.status,
          observed_at: discovery.observed_at,
          manifest_errors: discovery.errors || []
        },
        self_model: selfModel,
        status: "discovered",
        error: null,
        trace: ["discover"]
      };
    })
    .addNode("plan", async (state) => {
      const discovery = await collectCapabilityManifests(env);
      const plan = await compileTaskPlan(state.task, discovery.manifests || []);
      return {
        plan,
        status: plan.ok ? "planned" : "repair-required",
        error: plan.ok ? null : "LANGGRAPH_PLAN_BLOCKED",
        trace: ["plan"]
      };
    })
    .addNode("validate", async (state) => {
      const validation = validateSupervisorPlan(state.plan);
      return {
        validation,
        status: validation.ok ? "ready" : "rejected",
        error: validation.ok ? null : "LANGGRAPH_PLAN_VALIDATION_FAILED",
        trace: ["validate"]
      };
    })
    .addNode("repair", async (state) => ({
      validation: {
        ok: false,
        fail_closed: true,
        unresolved: state.plan?.unresolved || [],
        gap_model: state.plan?.gap_model || null,
        production_mutation: false,
        execution_started: false
      },
      status: "blocked",
      error: state.plan?.status === "INVALID" ? "INVALID_TASK_ENVELOPE" : "CAPABILITY_GAP",
      trace: ["repair"]
    }))
    .addEdge(START, "discover")
    .addEdge("discover", "plan")
    .addConditionalEdges("plan", (state) => state.plan?.ok === true ? "validate" : "repair")
    .addEdge("validate", END)
    .addEdge("repair", END)
    .compile();
}

function buildProbeGraph() {
  return new StateGraph(ProbeState)
    .addNode("probe", async () => ({ status: "ready", trace: ["probe"] }))
    .addEdge(START, "probe")
    .addEdge("probe", END)
    .compile();
}

async function probeExpertChildRuntime(env) {
  if (!env?.EXPERT_CENTER?.fetch) return { ok: false, error: "EXPERT_CENTER_UNBOUND" };
  try {
    const response = await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/langgraph/health", { method: "GET" }));
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok && body?.ok === true,
      http_status: response.status,
      runtime: body?.runtime || null,
      state_graph: body?.state_graph === true
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || "EXPERT_LANGGRAPH_HEALTH_FAILED") };
  }
}

export async function probeLangGraphSupervisor(env) {
  const graph = buildProbeGraph();
  const result = await graph.invoke({ status: "starting", trace: [] });
  const expert = await probeExpertChildRuntime(env);
  return {
    ok: result.status === "ready" && expert.ok === true,
    runtime: LANGGRAPH_SUPERVISOR_RUNTIME,
    mode: "governance-supervisor",
    state_graph: true,
    service_binding_orchestration: true,
    expert_child_runtime: expert,
    autonomous_production_mutation: false,
    trace: result.trace || []
  };
}

export async function runLangGraphSupervisor(task, env) {
  const graph = buildSupervisorGraph(env);
  const result = await graph.invoke({
    task,
    discovery: null,
    self_model: null,
    plan: null,
    validation: null,
    status: "received",
    error: null,
    trace: []
  });
  return {
    ok: result.status === "ready",
    runtime: LANGGRAPH_SUPERVISOR_RUNTIME,
    mode: "plan-validate-repair",
    status: result.status,
    error: result.error || null,
    discovery: result.discovery || null,
    self_model: result.self_model || null,
    plan: result.plan || null,
    validation: result.validation || null,
    trace: result.trace || [],
    execution_started: false,
    side_effects_started: false,
    autonomous_production_mutation: false
  };
}
