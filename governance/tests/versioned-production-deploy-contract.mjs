import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../scripts/versioned-production-deploy.mjs",import.meta.url),"utf8");
assert.match(source,/PRODUCTION_BRANCH_REQUIRED/);
assert.match(source,/WRANGLER_LIFECYCLE_CHANGE_REQUIRES_ATOMIC_DEPLOY/);
assert.match(source,/versions","upload/);
assert.match(source,/--keep-vars/);
assert.match(source,/versions","deploy/);
assert.match(source,/@100%/);
assert.match(source,/GOVERNANCE_VERSIONED_PRODUCTION_ROLLBACK_COMPLETE/);
assert.match(source,/verify100/);
assert.doesNotMatch(source,/wrangler@\$\{v\}","deploy"/);
console.log(JSON.stringify({ok:true,suite:"versioned-production-deploy-contract",fail_closed:true,rollback:true,lifecycle_change_blocked:true}));
