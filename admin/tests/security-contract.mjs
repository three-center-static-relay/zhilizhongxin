import assert from "node:assert/strict";
import {verifyBearer} from "../src/security.js";

const request=token=>new Request("https://admin.internal",{headers:{authorization:`Bearer ${token}`}});
assert.equal(await verifyBearer(request("correct-token"),"correct-token"),true);
assert.equal(await verifyBearer(request("wrong-token"),"correct-token"),false);
assert.equal(await verifyBearer(new Request("https://admin.internal"),"correct-token"),false);
assert.equal(await verifyBearer(request("correct-token"),""),false);

console.log(JSON.stringify({ok:true,suite:"admin-security-contract",digest_comparison:true}));
