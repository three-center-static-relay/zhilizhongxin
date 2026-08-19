#!/usr/bin/env node
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {clean,extractSignal,publishCommitStatus} from "./cloudflare-github-status.mjs";

function emit(row,stream=process.stdout){stream.write(`${JSON.stringify({...row,secrets_redacted:true})}\n`)}
async function post(scope,mode,state,signal){
  const result=await publishCommitStatus({scope,mode,state,signal});
  emit({event:"CLOUDFLARE_GITHUB_STATUS",...result,state},result.ok?process.stdout:process.stderr);
  return result;
}
function wire(stream,target,signal){
  let buffer="";
  stream?.on("data",chunk=>{
    const text=String(chunk);
    target.write(text);
    buffer+=text;
    let i;
    while((i=buffer.indexOf("\n"))>=0){
      const line=buffer.slice(0,i);buffer=buffer.slice(i+1);
      extractSignal(line,signal);
    }
  });
  stream?.on("end",()=>{if(buffer.trim())extractSignal(buffer,signal)});
}
async function main(){
  const [scope,mode,command,...args]=process.argv.slice(2);
  if(!scope||!mode||!command)throw new Error("RECEIPT_RUNNER_USAGE");
  const signal={phase:"start"};
  await post(scope,mode,"pending",signal);
  const child=spawn(command,args,{cwd:process.cwd(),env:process.env,stdio:["inherit","pipe","pipe"],shell:false});
  wire(child.stdout,process.stdout,signal);
  wire(child.stderr,process.stderr,signal);
  const result=await new Promise(resolve=>child.on("close",(code,signalName)=>resolve({code:code??1,signalName})));
  const state=result.code===0?"success":"failure";
  signal.exit_code=result.code;
  if(result.signalName)signal.process_signal=clean(result.signalName,40);
  await post(scope,mode,state,signal);
  process.exitCode=result.code;
}
const invoked=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:"";
if(import.meta.url===invoked)main().catch(async error=>{
  emit({event:"CLOUDFLARE_RECEIPT_RUNNER_FAIL",error:clean(error?.message||error,160)},process.stderr);
  process.exitCode=1;
});
