import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const text=readFileSync(new URL("../TOP_LEVEL_CONSTITUTION.md",import.meta.url),"utf8");

assert.match(text,/Government public data: privacy-first public acquisition/i);
assert.match(text,/Mainland China default rule/i);
assert.match(text,/government information and public-sector data originating from Mainland China/i);
assert.match(text,/public collection is the default acquisition path/i);
assert.match(text,/Authenticated API\/MCP access to Mainland China government sources is an exception/i);
assert.match(text,/lawfully public, unauthenticated acquisition/i);
assert.match(text,/data minimization and identity-disclosure minimization/i);
assert.match(text,/must never claim that web collection is anonymous, untraceable, or invisible/i);
assert.match(text,/Do not create or use a government account, API credential, MCP identity/i);
assert.match(text,/bounded, low-frequency, cache-first and incremental collection/i);
assert.match(text,/Never bypass login, CAPTCHA, paywalls, access controls, rate limits/i);
assert.match(text,/Never use fingerprint spoofing, proxy rotation, credential cycling, anti-bot evasion/i);
assert.match(text,/identity-linked-access-required/i);
assert.match(text,/production evidence must come from the validated official source itself/i);
assert.match(text,/Collection parsers must fail closed/i);
assert.match(text,/For Mainland China government information, choose \*\*public collection first\*\*/i);

console.log(JSON.stringify({ok:true,suite:"top-level-constitution",rule:"G17-government-public-data-privacy-first",mainland_china_public_collection_default:true,identity_disclosure_minimized:true,authenticated_government_api_exception_only:true,anti_detection_evasion:false,anonymity_claim:false}));
