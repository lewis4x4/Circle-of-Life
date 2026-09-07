# SYS-001D user Edge authorization remediation

Status: source implemented and locally verified on 2026-09-07. Not deployed.

## Authority contract

The sixteen mapped user-invoked Edge Functions now resolve one shared current actor before constructing a service-role client or performing privileged work. The shared resolver uses the automatically injected `SUPABASE_ANON_KEY`, forwards only the request bearer token, and calls the authenticated-only `public.haven_current_edge_actor()` RPC. Migration 326 resolves signed identity, `session_id`, and `auth_claim_version` through `haven.current_authorized_actor()` and returns current active, nondeleted database profile role and organization plus live, nonrevoked, nondeleted facility scope in one database statement.

The RPC is not executable by `PUBLIC`, `anon`, or `service_role`. Request JSON and JWT `app_metadata` are never actor authority. Missing or malformed bearer tokens, missing/revoked sessions, deleted/banned Auth users, stale authorization versions, inactive/deleted profiles, role demotion, organization change, and facility revocation fail before privileged client construction. Role-restricted functions enforce their current database role allowlist at the same boundary.

Provider calls, metered AI/transcription/TTS operations, storage mutations, and user-attributed database mutations revalidate the same user, organization, role, authorization version, and requested facility immediately before the side effect. A changed binding fails with sanitized `401`/`403` responses and does not invoke the guarded provider operation. Cross-organization workspace IDs and inaccessible facility IDs are rejected rather than silently widening or defaulting scope.

Haven AI and Knowledge Agent now carry that revalidation callback through intent classification, dispatch, provider wrappers, tool RPCs, knowledge-gap writes, usage accounting, and persistence. Model fallbacks cannot swallow a `CurrentActorError`. SSE answer text, sources, citations, and token totals remain buffered until persistence finishes and one final revalidation succeeds; a mid-request revocation emits only a sanitized authorization event. Facility promotion revalidates per module, in every direct promoter mutation/RPC, before each promotion-link insert, and before each run-item/final status write.

Facility Launch fact review/application is one actor-bound service RPC: it locks the fact, atomically revalidates session/version/profile/role/organization/facility, changes approval state, supersedes prior values, inserts the replacement, marks the fact applied, and writes its audit receipt. Exact replay returns the original applied value without a second write or audit event; audit failure rolls the entire command back. Facility admins cannot parse, run, list, review, or apply organization-wide null-facility facts. Owners and organization admins retain existing organization-wide semantics and can list null facts alongside facts from their live facilities.

Document ingestion creates an RLS-closed durable authorization receipt before reindex/background mutation, binding run, document, organization, optional facility, actor, session, and claim version. Mutation start is recorded immediately before old chunks are removed. Each chunk batch revalidates. If authority disappears, a service-only cleanup command authorizes from the receipt rather than `documents.uploaded_by`, removes partial chunks only after mutation actually started, and leaves idempotent document/run `authorization_changed` failure state. Null or different uploaders do not prevent cleanup.

## Covered functions

- `boldsign-send-contract`
- `document-admin`
- `exec-nlq-executor`
- `exec-report-generator`
- `exec-scenario-solver`
- `facility-launch-parser`
- `facility-launch-import`
- `facility-launch-promote`
- `grace-execute-flow-step`
- `grace-orchestrator`
- `grace-transcribe`
- `grace-tts`
- `grace-undo-flow-run`
- `ingest`
- `knowledge-agent`
- `haven-ai-router`

All sixteen are now explicitly `verify_jwt = true` in `supabase/config.toml`. Machine/webhook functions retain their explicit `verify_jwt = false` mode and secret or provider-signature boundaries; this segment does not reinterpret machine credentials as user identity.

## Exclusions and remaining Edge audit

Machine-only cron/worker functions and signed webhooks were intentionally excluded, including `dispatch-push`, `report-scheduler`, `ar-aging-check`, the other scheduled workflow functions, and `boldsign-webhook`.

The supplied comparison functions `grace-execute-flow-step`, `grace-undo-flow-run`, `facility-launch-import`, and `facility-launch-promote` preserve their existing role, organization, facility, resource, receipt, and idempotency semantics while now using the same current-actor ordering. `facility-launch-promote` retains injected authorization/admin factories so its existing deterministic promotion tests prove denied requests never construct the privileged client.

## Threat and regression evidence

- Missing and malformed bearer headers: rejected before user-client construction.
- Inactive/deleted profile, stale version, and missing/revoked session result: rejected from the authoritative RPC.
- Live role demotion or organization change between initial check and side effect: revalidation rejects.
- Facility forgery or revocation: facility-targeted operation rejects.
- Provider denial path: guarded callback is not invoked.
- Delayed provider/dispatch revocation: no fallback result is returned and no provider call occurs when denial precedes the call.
- Delayed SSE revocation: no answer, source, citation, or token metadata is emitted.
- Knowledge Agent mid-loop revocation: zero answer/source chunks are emitted.
- Promotion mid-sequence revocation: no later target or link write occurs. An already-authorized first M17 target write can remain without its subsequent link when revocation lands between those two separately checked statements; the run remains reconcilable. Cross-write promoter rollback remains a separate SYS data-integrity gate rather than being misrepresented as atomic here.
- Interrupted ingest: durable exact/mismatch receipt replay is checked; partial chunks are removed, failure state is explicit, null/different uploaders are supported, and exact cleanup replay does not increment attempts twice.
- Mixed-facility document facts: facility admins retain only current-organization/live-facility rows, while owners/org admins also retain organization-wide null facts.
- Parser application: current/revoked/null scope, exact replay, and injected audit-failure rollback are exercised in the PostgreSQL probe.
- Service client ordering: an alias-aware handler scan checks all sixteen mapped functions and rejects service construction before current-actor authorization; `facility-launch-promote` additionally has an injected runtime denial test.
- Mixed endpoint modes: source contract checks all sixteen user functions are explicit `verify_jwt = true` and representative machine/webhook functions remain explicit `false`.

## Verification evidence

- Shared actor and source-contract Deno regressions: PASS, 13 tests.
- Full existing Edge test set plus the new regressions: PASS, 83 tests, runtime network denied, cached dependencies only, no lock mutation. The Knowledge Agent emission regression runs with type checking disabled only because the same six documented baseline errors remain in its imported module; all other Edge tests type-check normally.
- Deno typecheck: PASS for the shared helper and fourteen directly checkable mapped functions, including the four comparison functions and `haven-ai-router`, using the unchanged local dependency snapshot. `knowledge-agent` continues to report the same six pre-existing Supabase relation/source typing errors outside changed lines. `ingest` remains blocked from standalone Deno typecheck because the existing `npm:turndown@7.2.0` package is absent from this worktree's `node_modules`.
- Frozen `deno.lock` validation: preserved failure. The lock still reflects the earlier package snapshot while `package.json` contains later Next/TanStack versions; this is the reproducibility issue already recorded by the independent review. No dependency or lock refresh was performed in this segment.
- Full Vitest: PASS, 513 files; 3,114 passed, 2 skipped, 0 failed. Existing React `act(...)`, nested-button, expected error-path logging, and missing TypeScript source-map warnings remain nonfatal.
- ESLint and constitution lint: PASS.
- TypeScript typecheck: PASS.
- Production build: PASS, including migration sequence, admin shell, memory-care checks, compilation, TypeScript, and 447 static pages.
- Native PostgreSQL 17.9 replay: PASS, 329 migration files and 11 SQL probes. The new probe verifies the atomic Edge snapshot, authenticated-only grant posture, live role/org/facility values, missing-session denial, transactional parser apply/replay/audit rollback, and durable interrupted-ingest receipt cleanup/grants/idempotency. Machine-readable proof: `test-results/agent-gates/2026-09-07T05-10-47Z-SYS-001D-NATIVE-PG-FINAL.json`.
- `git diff --check`: PASS.
- Historical pre-review replacement gate: `test-results/agent-gates/2026-09-07T04-10-25-519Z-SYS-001D-EDGE-AUTHORIZATION-FINAL2.json`. It remains preserved but is superseded by the review-fix replacement gate recorded below. Its Docker line predated the corrected skip-classification logic and must not be used as database evidence.
- Final review-fix replacement gate: PASS at `test-results/agent-gates/2026-09-07T05-17-47-138Z-SYS-001D-EDGE-AUTHORIZATION-FINAL-REVIEW2.json`; 9 passed, 0 failed, 4 optional skips. The PostgreSQL line is correctly recorded as `skipped`, not `passed`; the separate native PostgreSQL JSON artifact above is the database proof.

## Hosted gates

Deploy migration 326 and all changed user Edge Functions as one matched release. Confirm the Auth custom-access-token hook and PostgREST pre-request hook are enabled on the target. With real signed tokens, repeat active access, disable, soft-delete, demotion, organization change, facility revoke/regrant, session deletion, stale-version refresh, cross-organization workspace ID, and inaccessible facility ID cases. Confirm provider dashboards show no BoldSign, Anthropic, or OpenAI request for every denied case, and confirm no service-role mutation or audit row was created.

The Docker verification container `haven-pg-verify-1788752919790` was created by this run. The Docker daemon became unresponsive during replay; associated host processes were terminated, but the daemon did not confirm exact-container removal. Do not use broad Docker cleanup. Remove only that exact container once the daemon responds.

## Mission alignment

**Pass for the sixteen mapped functions at source level.** Current human authority and facility scope now precede their privileged reads, writes, and provider work. Operational alignment remains **risk** until the matched hosted signed-token matrix passes.
