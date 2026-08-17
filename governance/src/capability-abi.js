export const CAPABILITY_ABI_VERSION="capability-abi-v1";
export const TRUST_LEVELS=Object.freeze(["T0","T1","T2","T3","T4"]);

const REQUIRED_FIELDS=Object.freeze([
  "id","type","domain","operations","input_schema","output_schema","provider","protocol","version",
  "auth_scope","permission_scope","network_scope","write_scope","dependencies","substitutes","compatible_with",
  "conflicts_with","cost","latency","throughput","reliability","accuracy","freshness","health","fitness","trust",
  "license","jurisdiction","first_seen","last_verified"
]);

const plain=value=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const text=(value,fallback="")=>typeof value==="string"&&value.trim()?value.trim():fallback;
const list=value=>Array.isArray(value)?[...new Set(value.map(x=>String(x).trim()).filter(Boolean))]:[];
const score=value=>Math.max(0,Math.min(1,Number.isFinite(Number(value))?Number(value):0));
const finiteBetween=(value,min,max)=>Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max;
const validDate=value=>typeof value==="string"&&!Number.isNaN(Date.parse(value));

export function makeCapability(input){
  const observedAt=text(input?.last_verified,new Date().toISOString());
  return {
    id:text(input?.id),type:text(input?.type,"atomic"),domain:text(input?.domain,"general"),operations:list(input?.operations),
    input_schema:plain(input?.input_schema)?input.input_schema:{type:"object"},
    output_schema:plain(input?.output_schema)?input.output_schema:{type:"object"},
    provider:text(input?.provider,"internal"),protocol:text(input?.protocol,"service-binding"),version:text(input?.version,"1.0.0"),
    auth_scope:text(input?.auth_scope,"service-binding"),permission_scope:text(input?.permission_scope,"read"),
    network_scope:text(input?.network_scope,"none"),write_scope:text(input?.write_scope,"none"),
    dependencies:list(input?.dependencies),substitutes:list(input?.substitutes),compatible_with:list(input?.compatible_with),conflicts_with:list(input?.conflicts_with),
    cost:{class:text(input?.cost?.class,"zero-internal"),currency:text(input?.cost?.currency,"USD"),unit_cost:Math.max(0,Number(input?.cost?.unit_cost)||0)},
    latency:{class:text(input?.latency?.class,"interactive"),timeout_ms:Math.max(1,Number(input?.latency?.timeout_ms)||30000)},
    throughput:{class:text(input?.throughput?.class,"bounded"),max_concurrency:Math.max(1,Math.trunc(Number(input?.throughput?.max_concurrency)||1))},
    reliability:{score:score(input?.reliability?.score??0.5),basis:text(input?.reliability?.basis,"contract")},
    accuracy:{score:score(input?.accuracy?.score??0.5),basis:text(input?.accuracy?.basis,"contract")},
    freshness:{observed_at:text(input?.freshness?.observed_at,observedAt),ttl_seconds:Math.max(0,Math.trunc(Number(input?.freshness?.ttl_seconds)||86400))},
    health:{status:text(input?.health?.status,"unknown"),checked_at:text(input?.health?.checked_at,observedAt)},
    fitness:{
      quality:score(input?.fitness?.quality??input?.accuracy?.score??0.5),reliability:score(input?.fitness?.reliability??input?.reliability?.score??0.5),
      cost:score(input?.fitness?.cost??1),latency:score(input?.fitness?.latency??0.5),security:score(input?.fitness?.security??0.8),
      adaptability:score(input?.fitness?.adaptability??0.5),complexity:score(input?.fitness?.complexity??0.5)
    },
    trust:{level:TRUST_LEVELS.includes(input?.trust?.level)?input.trust.level:"T0",status:text(input?.trust?.status,"quarantined")},
    license:text(input?.license,"internal"),jurisdiction:list(input?.jurisdiction).length?list(input.jurisdiction):["global"],
    first_seen:text(input?.first_seen,observedAt),last_verified:observedAt
  };
}

export function validateCapability(capability){
  const errors=[];
  if(!plain(capability))return{ok:false,errors:["CAPABILITY_NOT_OBJECT"]};
  for(const field of REQUIRED_FIELDS)if(!(field in capability))errors.push(`MISSING_${field.toUpperCase()}`);
  if(!/^[a-z0-9][a-z0-9._:-]{2,159}$/.test(String(capability.id||"")))errors.push("INVALID_ID");
  for(const name of ["type","domain","provider","protocol","version","auth_scope","permission_scope","network_scope","license"])if(!text(capability[name]))errors.push(`INVALID_${name.toUpperCase()}`);
  if(!Array.isArray(capability.operations)||capability.operations.length===0||capability.operations.some(x=>!text(x)))errors.push("OPERATIONS_REQUIRED");
  if(!plain(capability.input_schema)||!plain(capability.output_schema))errors.push("INVALID_IO_SCHEMA");
  if(!TRUST_LEVELS.includes(capability?.trust?.level))errors.push("INVALID_TRUST_LEVEL");
  if(!plain(capability.trust)||!text(capability.trust?.status))errors.push("INVALID_TRUST");
  if(!["none","read","write","destructive"].includes(String(capability.write_scope||"")))errors.push("INVALID_WRITE_SCOPE");
  for(const name of ["dependencies","substitutes","compatible_with","conflicts_with","jurisdiction"])if(!Array.isArray(capability[name])||capability[name].some(x=>typeof x!=="string"))errors.push(`INVALID_${name.toUpperCase()}`);
  if(!plain(capability.cost)||!text(capability.cost?.class)||!text(capability.cost?.currency)||!finiteBetween(capability.cost?.unit_cost,0,Number.MAX_SAFE_INTEGER))errors.push("INVALID_COST");
  if(!plain(capability.latency)||!text(capability.latency?.class)||!finiteBetween(capability.latency?.timeout_ms,1,Number.MAX_SAFE_INTEGER))errors.push("INVALID_LATENCY");
  if(!plain(capability.throughput)||!text(capability.throughput?.class)||!Number.isInteger(capability.throughput?.max_concurrency)||capability.throughput.max_concurrency<1)errors.push("INVALID_THROUGHPUT");
  for(const name of ["reliability","accuracy"])if(!plain(capability[name])||!finiteBetween(capability[name]?.score,0,1)||!text(capability[name]?.basis))errors.push(`INVALID_${name.toUpperCase()}`);
  if(!plain(capability.freshness)||!validDate(capability.freshness?.observed_at)||!Number.isInteger(capability.freshness?.ttl_seconds)||capability.freshness.ttl_seconds<0)errors.push("INVALID_FRESHNESS");
  if(!plain(capability.health)||!text(capability.health?.status)||!validDate(capability.health?.checked_at))errors.push("INVALID_HEALTH");
  if(!plain(capability.fitness)||["quality","reliability","cost","latency","security","adaptability","complexity"].some(name=>!finiteBetween(capability.fitness?.[name],0,1)))errors.push("INVALID_FITNESS");
  if(!validDate(capability.first_seen)||!validDate(capability.last_verified))errors.push("INVALID_VERIFICATION_DATE");
  return{ok:errors.length===0,errors};
}

export function buildManifest(center,capabilities,ecology=[]){
  return {abi_version:CAPABILITY_ABI_VERSION,center,generated_at:new Date().toISOString(),capabilities,ecology};
}

export function validateManifest(manifest){
  const errors=[];
  if(!plain(manifest))return{ok:false,errors:["MANIFEST_NOT_OBJECT"]};
  if(manifest.abi_version!==CAPABILITY_ABI_VERSION)errors.push("ABI_VERSION_MISMATCH");
  if(!text(manifest.center))errors.push("CENTER_REQUIRED");
  if(!Array.isArray(manifest.capabilities)||manifest.capabilities.length===0)errors.push("CAPABILITIES_REQUIRED");
  const ids=new Set();
  for(const capability of manifest.capabilities||[]){
    const result=validateCapability(capability);
    for(const error of result.errors)errors.push(`${capability?.id||"unknown"}:${error}`);
    if(ids.has(capability?.id))errors.push(`${capability?.id}:DUPLICATE_ID`);
    ids.add(capability?.id);
  }
  return{ok:errors.length===0,errors};
}

export async function sha256Json(value){
  const encoded=new TextEncoder().encode(JSON.stringify(value));
  const digest=await crypto.subtle.digest("SHA-256",encoded);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
