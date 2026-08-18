const encoder = new TextEncoder();

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value || ""))));
}

function equalDigest(left,right){
  if(typeof crypto.subtle.timingSafeEqual==="function")return crypto.subtle.timingSafeEqual(left,right);
  let difference=0;
  for(let index=0;index<left.length;index++)difference|=left[index]^right[index];
  return difference===0;
}

export async function verifyBearer(request, expectedToken) {
  if (!expectedToken) return false;
  const [actualDigest, expectedDigest] = await Promise.all([
    sha256(bearerToken(request)),
    sha256(expectedToken)
  ]);
  return equalDigest(actualDigest, expectedDigest);
}
