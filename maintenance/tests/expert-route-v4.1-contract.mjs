import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../src/expert-route-manager.js",import.meta.url),"utf8");
const config=fs.readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");
assert.match(source,/expert-route-registry-v4\.1/);
assert.match(source,/AI_GATEWAY_ROUTE_REGISTRY/);
assert.match(source,/EXPERT_PROVIDER_CANDIDATES_JSON/);
assert.match(source,/provider:candidate\.provider/);
assert.match(source,/source:"provider-registry"/);
assert.match(source,/customCandidates/);
assert.match(source,/provider_sources/);
assert.match(source,/type:"percentage"/);
assert.match(source,/EXPERT_CHALLENGER_PERCENT/);
assert.match(source,/challengerPercent>0/);
assert.match(source,/routeKey!=="regulated"/);
assert.match(source,/regulated_exploration_percent:0/);
assert.match(source,/metadata\.cost_mode/);
assert.match(source,/"\$eq":"free-first"/);
assert.match(source,/"\$eq":"quality-first"/);
assert.match(source,/return\{timeout:60000,retries:1\}/);
assert.match(source,/MIN_LANES=2/);
assert.match(source,/MAX_LANES=8/);
assert.match(source,/exact:false/);
assert.match(source,/legacy_route_removed:true/);
assert.doesNotMatch(source,/LEGACY_SLOTS/);
assert.doesNotMatch(source,/metadata\.expert_slot/);
assert.doesNotMatch(source,/routeName=String\(env\.AI_GATEWAY_ROUTE/);
assert.doesNotMatch(source,/properties:\{provider:"openrouter",model/);

// Current production candidate policy is deliberately narrow: OpenRouter is the broad
// model supermarket; native DeepSeek is the only direct provider lane.
assert.match(config,/"EXPERT_PROVIDER_POLICY"\s*:\s*"openrouter-plus-deepseek-only"/);
assert.match(config,/\\"provider\\":\\"deepseek\\"/);
assert.match(config,/\\"model\\":\\"deepseek-v4-pro\\"/);
assert.match(config,/\\"company\\":\\"deepseek\\"/);
assert.doesNotMatch(config,/tencent|tokenhub/i);
assert.doesNotMatch(config,/byte[dD]ance|moonshot|mistral|groq|cerebras/i);

console.log(JSON.stringify({ok:true,suite:"expert-route-v4.1-contract",registry_driven:true,provider_policy:"openrouter-plus-deepseek-only",openrouter_model_supermarket:true,native_deepseek_direct:true,deepseek_model:"deepseek-v4-pro",three_cost_modes:true,challenger_percentage:true,regulated_exploration_disabled:true,dynamic_lanes:true,legacy_route_removed:true}));
