import assert from "node:assert/strict";
import {eligibleExpertCandidate,selectExpertCandidatePool,EXPERT_CANDIDATE_QUERY} from "../src/expert-candidate-pool.js";

const m=(id,extra={})=>({
  id,
  pricing:{prompt:"0.000001",completion:"0.000002",request:"0"},
  supported_parameters:["reasoning","max_tokens"],
  architecture:{output_modalities:["text"]},
  expiration_date:null,
  ...extra
});

const ranked=[
  m("openai/gpt-x"),
  m("anthropic/claude-x"),
  m("google/gemini-pro"),
  m("google/gemini-pro-backup"),
  m("deepseek/deepseek-r1"),
  m("mistralai/magistral"),
  m("qwen/qwen-reasoner"),
  m("xai/grok-flash"),
  m("moonshotai/kimi-free:free")
];

assert.equal(EXPERT_CANDIDATE_QUERY.params.sort,"intelligence-high-to-low");
assert.equal(eligibleExpertCandidate(ranked[0]),false);
assert.equal(eligibleExpertCandidate(ranked[1]),false);
assert.equal(eligibleExpertCandidate(ranked[2]),true);

const pool=selectExpertCandidatePool(ranked,{now:"2026-08-18T00:00:00Z"});
assert.equal(pool.ready,true);
assert.deepEqual(pool.lanes.map(x=>x.company),["google","deepseek","mistralai","qwen"]);
assert.equal(pool.lanes[0].primary,"google/gemini-pro");
assert.deepEqual(pool.lanes[0].fallbacks,["google/gemini-pro-backup"]);
assert.equal(new Set(pool.lanes.map(x=>x.company)).size,4);

const freeOnly=selectExpertCandidatePool([m("google/free:free")]);
assert.equal(freeOnly.ready,false);

console.log("expert candidate pool: pass");
