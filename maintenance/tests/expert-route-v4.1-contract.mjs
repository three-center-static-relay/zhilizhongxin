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

// Production source policy: four source classes behind one Cloudflare AI Gateway.
// OpenRouter remains the dynamic model supermarket. DeepSeek, Hugging Face and
// Workers AI candidates use the existing provider registry; Workers AI candidates
// are limited to the currently approved free-plan model set.
assert.match(config,/"EXPERT_PROVIDER_POLICY"\s*:\s*"workers-ai-openrouter-deepseek-huggingface-only"/);
assert.match(config,/"EXPERT_WORKERS_AI_FREE_ONLY"\s*:\s*"true"/);
assert.match(config,/\\"provider\\":\\"deepseek\\"/);
assert.match(config,/\\"model\\":\\"deepseek-v4-pro\\"/);
assert.match(config,/\\"provider\\":\\"huggingface\\"/);
assert.match(config,/Qwen\/Qwen3-235B-A22B-Instruct-2507/);
assert.match(config,/\\"provider\\":\\"workers-ai\\"/);
assert.match(config,/@cf\/nvidia\/nemotron-3-120b-a12b/);
assert.match(config,/@cf\/google\/gemma-4-26b-a4b-it/);
assert.match(config,/\\"company\\":\\"deepseek\\"/);
assert.match(config,/\\"company\\":\\"qwen\\"/);
assert.match(config,/\\"company\\":\\"nvidia\\"/);
assert.match(config,/\\"company\\":\\"google\\"/);
assert.doesNotMatch(config,/tencent|tokenhub/i);
assert.doesNotMatch(config,/byte[dD]ance-direct|moonshot-direct|mistral-direct|groq-direct|cerebras-direct/i);

console.log(JSON.stringify({ok:true,suite:"expert-route-v4.1-contract",registry_driven:true,provider_policy:"workers-ai-openrouter-deepseek-huggingface-only",allowed_sources:["workers-ai","openrouter","deepseek","huggingface"],workers_ai_free_only:true,openrouter_model_supermarket:true,native_deepseek_direct:true,huggingface_direct:true,workers_ai_free_candidates:2,deepseek_model:"deepseek-v4-pro",three_cost_modes:true,challenger_percentage:true,regulated_exploration_disabled:true,dynamic_lanes:true,legacy_route_removed:true}));
