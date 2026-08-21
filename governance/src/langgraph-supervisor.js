import { buildSelfModel, collectCapabilityManifests, compileTaskPlan } from "./evolution-kernel.js";
import { storeNeonMemory } from "./neon-memory.js";

export const LANGGRAPH_SUPERVISOR_RUNTIME = "@langchain/langgraph@1.4.10";
export const LANGGRAPH_RUNTIME_HOST = "expert-worker";

async function probeExpertLangGraph(env) {
  if (!env?.EXPERT_CENTER?.fetch) return { ok: false, error: "EXPERT_CENTER_UNBOUND" };
  try {
    const response = await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/langgraph/health", { method: "GET" }));
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok && body?.ok === true && body?.state_graph === true,
      http_status: response.status,
      runtime: body?.runtime || null,
      state_graph: body?.state_graph === true,
      supervisor_validation: body?.supervisor_validation === true
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || "EXPERT_LANGGRAPH_HEALTH_FAILED") };
  }
}

async function validatePlanWithLangGraph(plan, env) {
  if (!env?.EXPERT_CENTER?.fetch) return { ok: false, error: "EXPERT_CENTER_UNBOUND" };
  try {
    const response = await env.EXPERT_CENTER.fetch(new Request("https://expert.internal/v1/langgraph/run", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ mode: "supervisor-validate", plan })
    }));
    const body = await response.json().catch(() => null);
    const ok = response.ok
      && body?.ok === true
      && body?.mode === "supervisor-validate"
      && body?.validation?.ok === true
      && body?.model_invoked === false
      && body?.tools_used === false
      && body?.web_used === false;
    return {
      ok,
      http_status: response.status,
      runtime: body?.runtime || null,
      status: body?.status || null,
      validation: body?.validation || null,
      trace: body?.trace || [],
      model_invoked: body?.model_invoked === true,
      tools_used: body?.tools_used === true,
      web_used: body?.web_used === true,
      error: ok ? null : String(body?.error || `LANGGRAPH_VALIDATION_HTTP_${response.status}`)
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || "LANGGRAPH_VALIDATION_FAILED") };
  }
}

async function persistSupervisorMemory(task, result, env) {
  return storeNeonMemory(env, {
    center: "governance",
    kind: "langgraph-supervisor",
    task_id: task?.task_id || null,
    memory_id: task?.task_id ? `langgraph-supervisor:${task.task_id}` : undefined,
    payload: {
      task: {
        task_id: task?.task_id || null,
        goal: task?.goal || null,
        required_capabilities: Array.isArray(task?.required_capabilities) ? task.required_capabilities : [],
        success_criteria: Array.isArray(task?.success_criteria) ? task.success_criteria : [],
        budget: task?.budget || null,
        risk: task?.risk || null
      },
      result
    }
  });
}

export async function probeLangGraphSupervisor(env) {
  const expert = await probeExpertLangGraph(env);
  return {
    ok: expert.ok === true && expert.supervisor_validation === true,
    runtime: LANGGRAPH_SUPERVISOR_RUNTIME,
    runtime_host: LANGGRAPH_RUNTIME_HOST,
    mode: "governance-supervisor-service-binding",
    state_graph: expert.state_graph === true,
    service_binding_orchestration: true,
    expert_child_runtime: expert,
    autonomous_production_mutation: false,
    trace: ["expert-langgraph-health"]
  };
}

export async function runLangGraphSupervisor(task, env) {
  const discovery = await collectCapabilityManifests(env);
  const selfModel = buildSelfModel(discovery.manifests || []);
  const plan = await compileTaskPlan(task, discovery.manifests || []);

  if (plan?.ok !== true) {
    const result = {
      ok: false,
      runtime: LANGGRAPH_SUPERVISOR_RUNTIME,
      runtime_host: LANGGRAPH_RUNTIME_HOST,
      mode: "plan-validate-repair",
      status: "blocked",
      error: plan?.status === "INVALID" ? "INVALID_TASK_ENVELOPE" : "CAPABILITY_GAP",
      discovery: {
        ok: discovery.ok === true,
        status: discovery.status,
        observed_at: discovery.observed_at,
        manifest_errors: discovery.errors || []
      },
      self_model: selfModel,
      plan,
      validation: {
        ok: false,
        fail_closed: true,
        unresolved: plan?.unresolved || [],
        gap_model: plan?.gap_model || null,
        production_mutation: false,
        execution_started: false,
        side_effects_started: false
      },
      trace: ["discover", "plan", "repair"],
      execution_started: false,
      side_effects_started: false,
      autonomous_production_mutation: false
    };
    const shared_memory = await persistSupervisorMemory(task, result, env);
    return { ...result, shared_memory };
  }

  const langgraph = await validatePlanWithLangGraph(plan, env);
  const ok = langgraph.ok === true;
  const result = {
    ok,
    runtime: LANGGRAPH_SUPERVISOR_RUNTIME,
    runtime_host: LANGGRAPH_RUNTIME_HOST,
    mode: "plan-validate-repair",
    status: ok ? "ready" : "rejected",
    error: ok ? null : (langgraph.error || "LANGGRAPH_PLAN_VALIDATION_FAILED"),
    discovery: {
      ok: discovery.ok === true,
      status: discovery.status,
      observed_at: discovery.observed_at,
      manifest_errors: discovery.errors || []
    },
    self_model: selfModel,
    plan,
    validation: langgraph.validation || {
      ok: false,
      fail_closed: true,
      production_mutation: false,
      execution_started: false,
      side_effects_started: false
    },
    langgraph_runtime: {
      host: LANGGRAPH_RUNTIME_HOST,
      http_status: langgraph.http_status || null,
      runtime: langgraph.runtime || null,
      model_invoked: langgraph.model_invoked === true,
      tools_used: langgraph.tools_used === true,
      web_used: langgraph.web_used === true
    },
    trace: ["discover", "plan", ...(langgraph.trace || ["langgraph-validate"])],
    execution_started: false,
    side_effects_started: false,
    autonomous_production_mutation: false
  };
  const shared_memory = await persistSupervisorMemory(task, result, env);
  return { ...result, shared_memory };
}
