const url='https://admin-worker.a15280020511.workers.dev/';
const c=new AbortController();
const t=setTimeout(()=>c.abort(),15000);
try{
  const r=await fetch(url,{headers:{accept:'application/json'},signal:c.signal,redirect:'manual'});
  console.log(JSON.stringify({probe:'admin-workers-dev-network',status:r.status,http_response:true,content_type:r.headers.get('content-type')}));
}catch(e){
  console.error(JSON.stringify({probe:'admin-workers-dev-network',http_response:false,network_error:String(e?.message||e)}));
  process.exitCode=24;
}finally{clearTimeout(t)}
