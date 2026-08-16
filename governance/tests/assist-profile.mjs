import assert from "node:assert/strict";
import { assistRoutingInfo } from "../src/assist.js";

const routing = assistRoutingInfo();
const profile = routing.generation_profile;
const collaboration = routing.collaboration;

assert.equal(profile.name, "governance-assist-high-reasoning-v1");
assert.equal(profile.fixed_system_prompt, true);
assert.equal(profile.sampling.temperature, 0.2);
assert.equal(profile.sampling.top_p, 0.9);
assert.equal(profile.sampling.stream, false);
assert.equal(profile.reasoning_effort, "high");
assert.equal(profile.unsupported_reasoning_control_behavior, "system-prompt-enforced");
assert.deepEqual(profile.max_tokens, { default: 4096, min: 256, max: 16384 });
assert.deepEqual(profile.reasoning_effort_models, [
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/zai-org/glm-4.7-flash"
]);
assert.equal(routing.openrouter.reasoning_effort, "high");
assert.equal(routing.mode, "single-model-serial-failover");
assert.equal(collaboration.required, true);
assert.equal(collaboration.scope, "every-work-item-and-all-repository-cloudflare-use");
assert.equal(collaboration.repository_use_requires_collaboration, true);
assert.equal(collaboration.cloudflare_use_requires_collaboration, true);
assert.equal(collaboration.invocation, "before-substantive-work-or-repository-cloudflare-use");
assert.equal(collaboration.normal_work_must_reach_auxiliary_model, true);
assert.equal(collaboration.bypass_only_by_controller_cancel, true);
assert.equal(collaboration.outage_behavior, "web-gpt-degraded-fallback");
assert.equal(collaboration.tool_access, "none");

assert.equal(routing.cloudflare.free_only, true);
assert.equal(routing.cloudflare.paid_models_allowed, false);
assert.equal(routing.cloudflare.quota_failure_behavior, "continue-remaining-free-models");
assert.equal(routing.cloudflare.exhaust_free_pool_before_openrouter, true);
assert.equal(routing.openrouter.free_models, false);
assert.equal(routing.openrouter.free_models_allowed, false);
assert.equal(routing.openrouter.paid_only, true);
assert.equal(routing.openrouter.entry_condition, "cloudflare-free-pool-exhausted");

console.log(JSON.stringify({
  ok: true,
  suite: "governance-assist-profile",
  profile: profile.name,
  mandatory_collaboration: true,
  collaboration_scope: collaboration.scope,
  repository_use_requires_collaboration: true,
  cloudflare_use_requires_collaboration: true,
  cloudflare_model_tier: "free-only",
  openrouter_model_tier: "paid-only"
}));
