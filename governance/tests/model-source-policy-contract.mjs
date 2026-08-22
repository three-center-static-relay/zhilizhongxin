import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,"../..");
const roots=["governance/src","admin/src","maintenance/src"];
const files=[];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,item.name);if(item.isDirectory())walk(full);else if(/\.(?:js|mjs|json|jsonc)$/.test(item.name))files.push(full)}}
for(const rel of roots)walk(path.join(repo,rel));
for(const rel of ["governance/wrangler.jsonc","admin/wrangler.jsonc","maintenance/wrangler.jsonc"])files.push(path.join(repo,rel));
const text=files.map(f=>fs.readFileSync(f,"utf8")).join("\n");
const forbidden=[
  /https:\/\/api\.deepseek\.com/i,
  /DEEPSEEK_API_KEY/,
  /aistudio\.baidu\.com\/llm/i,
  /api-inference\.modelscope\.cn/i,
  /dashscope\.aliyuncs\.com\/compatible-mode/i,
  /SILICONFLOW_API_KEY/,
  /ZHIPU_API_KEY/
];
for(const pattern of forbidden)assert.doesNotMatch(text,pattern,`direct model source forbidden: ${pattern}`);
const maintenance=fs.readFileSync(path.join(repo,"maintenance/wrangler.jsonc"),"utf8");
assert.match(maintenance,/"EXPERT_MODEL_SOURCE_CLASSES":\s*"workers-ai,openrouter,huggingface"/);
assert.match(maintenance,/"EXPERT_WORKERS_AI_FREE_ONLY":\s*"true"/);
console.log(JSON.stringify({ok:true,suite:"governance-model-source-policy",approved_sources:["workers-ai","openrouter","huggingface"],workers_ai_free_only:true,direct_vendor_sources:false,scanned_runtime_files:files.length}));
