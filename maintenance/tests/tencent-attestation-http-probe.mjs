const url='https://admin-worker.a15280020511.workers.dev/_internal/tencent-production-attestation';
const c=new AbortController();
const t=setTimeout(()=>c.abort(),15000);
try{
  const r=await fetch(url,{headers:{accept:'application/json'},signal:c.signal});
  console.log(JSON.stringify({probe:'tencent-attestation-http',status:r.status,ok:r.ok,content_type:r.headers.get('content-type')}));
  if(r.status!==200)process.exitCode=23;
}catch(e){
  console.error(JSON.stringify({probe:'tencent-attestation-http',network_error:String(e?.message||e)}));
  process.exitCode=24;
}finally{clearTimeout(t)}
