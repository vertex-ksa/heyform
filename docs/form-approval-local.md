# Local native submission approval packet

This FORM-02 candidate is disabled in production. It is an acceptance draft, not a completed epic or a downstream action authorization adapter.

Enable only in a synthetic local environment with server `FORM_APPROVAL_LOCAL_ENABLED=true`, a non-production NODE_ENV, and frontend `VITE_FORM_APPROVAL_LOCAL_ENABLED=true` in Vite development mode. Existing native Auth/FormGuard and current project/team memberships apply. Requesters cannot approve their own requests. One or two assigned reviewers decide sequentially.

Newly issued submission tokens bind the displayed form version; normal persisted submissions carry the original form schema snapshot. Legacy records are approval-ineligible. Each request binds that snapshot, answers, hidden fields, variables, and material contentRevision to a SHA256 typed canonical profile. Aggregate revision controls compare-and-set separately. Decisions preserve contentRevision; answer edits advance it and invalidate the approval while retaining audit. Replacement requests preserve up to20 previous records; old command keys cannot start new requests. Receipts are LOCAL and expire after seven days. No pay, send, sign, stock, or provider action is implemented here.

Verified locally: server TypeScript noEmit; approval domain assertions; full existing unit runner with DISABLE_V8_COMPILE_CACHE=1; complete-submission-security, submission-quota, and update-submission-answer-security tests. Frontend noEmit remains failing with468 existing diagnostics; exact baseline using the same frozen dependencies produced the same file/code/message multiplicity. Changed UI has no additional diagnostics in that comparison.

Still required: real native Mongo persistence test, authenticated GraphQL membership/denial flows, actual rendered English/Arabic mobile and wide states, peer acceptance, migration/rollback rehearsal, and full repository release gates. Docker recovery prevents runtime acceptance presently; a failed native Mongo attempt is recorded as ECONNREFUSED, never as a pass. Do not enable beyond local development based on this packet.

Run server checks from packages/server using the installed frozen pnpm10 dependencies:

```
node_modules/.bin/tsc --noEmit
DISABLE_V8_COMPILE_CACHE=1 node -r ts-node/register/transpile-only -r tsconfig-paths/register test/run-unit.ts
DISABLE_V8_COMPILE_CACHE=1 node -r ts-node/register/transpile-only -r tsconfig-paths/register test/complete-submission-security.test.ts
DISABLE_V8_COMPILE_CACHE=1 node -r ts-node/register/transpile-only -r tsconfig-paths/register test/submission-quota.test.ts
DISABLE_V8_COMPILE_CACHE=1 node -r ts-node/register/transpile-only -r tsconfig-paths/register test/update-submission-answer-security.test.ts
```

Real persistence test requires TM_C_APPROVAL_MONGO_URI pointing to an explicitly isolated database named tm_c_approval_* on127.0.0.1:27119. It deletes only that guarded synthetic database. It tests concurrent CAS, idempotency, scoped denial, two reviewers, stable material version, edit invalidation, retained history, legacy denial, and private-record denial. Do not point it at shared or user data.

Full evidence checkpoint: D:/Technominds-Execution-Evidence-20261001/C. Required program acceptance remains open.
