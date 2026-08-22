import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,"../..");
const runtimeRoots=["governance/src","admin/src","maintenance/src"];
const runtimeFiles=[];
function walkInto(dir,target){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,item.name);if(item.isDirectory())walkInto(full,target);else if(/\.(?:js|mjs|json|jsonc)$/.test(item.name))target.push(full)}}
for(const rel of runtimeRoots)walkInto(path.join(repo,rel),runtimeFiles);
for(const rel of ["governance/wrangler.jsonc","admin/wrangler.jsonc","maintenance/wrangler.jsonc","maintenance/wrangler.phase2.jsonc"])runtimeFiles.push(path.join(repo,rel));
const runtimeText=runtimeFiles.map(f=>fs.readFileSync(f,"utf8")).join("\n");
const directVendorForbidden=[
  /https:\/\/api\.deepseek\.com/i,
  /DEEPSEEK_API_KEY/,
  /aistudio\.baidu\.com\/llm/i,
  /api-inference\.modelscope\.cn/i,
  /dashscope\.aliyuncs\.com\/compatible-mode/i,
  /SILICONFLOW_API_KEY/,
  /ZHIPU_API_KEY/
];
for(const pattern of directVendorForbidden)assert.doesNotMatch(runtimeText,pattern,`direct model source forbidden: ${pattern}`);

const scripts=[];
walkInto(path.join(repo,"maintenance/scripts"),scripts);
const scriptText=scripts.map(f=>fs.readFileSync(f,"utf8")).join("\n");
for(const text of [runtimeText,scriptText]){
  assert.doesNotMatch(text,/workers-ai,openrouter,deepseek,huggingface/i,"legacy four-source list forbidden");
  assert.doesNotMatch(text,/EXPERT_MODEL_SOURCE_CLASSES[^\n]*deepseek/i,"phase/deploy source class must stay three-source");
}

const maintenance=fs.readFileSync(path.join(repo,"maintenance/wrangler.jsonc"),"utf8");
const phase2=fs.readFileSync(path.join(repo,"maintenance/wrangler.phase2.jsonc"),"utf8");
const governance=fs.readFileSync(path.join(repo,"governance/wrangler.jsonc"),"utf8");
assert.match(maintenance,/"EXPERT_MODEL_SOURCE_CLASSES":\s*"workers-ai,openrouter,huggingface"/);
assert.match(phase2,/"EXPERT_MODEL_SOURCE_CLASSES":\s*"workers-ai,openrouter,huggingface"/);
assert.match(governance,/"MODEL_SOURCE_CLASSES":\s*"workers-ai,openrouter,huggingface"/);
assert.match(maintenance,/"EXPERT_WORKERS_AI_FREE_ONLY":\s*"true"/);
console.log(JSON.stringify({ok:true,suite:"governance-model-source-policy",approved_sources:["workers-ai","openrouter","huggingface"],workers_ai_free_only:true,direct_vendor_sources:false,phase2_covered:true,maintenance_scripts_source_config_covered:true,scanned_runtime_files:runtimeFiles.length,scanned_maintenance_scripts:scripts.length}));
