import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const text=readFileSync(new URL("../TOP_LEVEL_CONSTITUTION.md",import.meta.url),"utf8");

assert.match(text,/Government public data: privacy-first public acquisition/i);
assert.match(text,/lawfully public, unauthenticated acquisition/i);
assert.match(text,/data minimization and identity-disclosure minimization/i);
assert.match(text,/must never claim that web collection is anonymous, untraceable, or invisible/i);
assert.match(text,/Do not create or use a government account, API credential, MCP identity/i);
assert.match(text,/bounded, low-frequency, cache-first and incremental collection/i);
assert.match(text,/Never bypass login, CAPTCHA, paywalls, access controls, rate limits/i);
assert.match(text,/Never use fingerprint spoofing, proxy rotation, credential cycling, anti-bot evasion/i);
assert.match(text,/identity-linked-access-required/i);
assert.match(text,/production evidence must come from the validated official source itself/i);
assert.match(text,/When public collection and authenticated API\/MCP provide materially equivalent evidence, choose \*\*public collection\*\*/i);

console.log(JSON.stringify({ok:true,suite:"top-level-constitution",rule:"G17-government-public-data-privacy-first",public_collection_preferred:true,identity_disclosure_minimized:true,anti_detection_evasion:false,anonymity_claim:false}));
