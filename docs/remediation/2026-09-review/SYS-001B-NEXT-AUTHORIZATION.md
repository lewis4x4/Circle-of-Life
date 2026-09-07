# SYS-001B Next route authorization remediation

Status: source implemented and locally verified on 2026-09-06. Not deployed.

## Authority contract

User-derived Next route handlers now resolve one shared current actor before constructing or using a service-role client. `requireCurrentApiActor` performs these steps in order:

1. Validate the cookie/bearer identity with `auth.getUser()`.
2. Read the acting user's active, nondeleted `user_profiles` row through the request-scoped Supabase client. Migration 326's PostgREST pre-request hook therefore rejects a missing/revoked session, deleted or banned Auth user, stale `auth_claim_version`, inactive profile, or soft-deleted profile before the profile query can succeed.
3. Take role and organization only from that current database row. Request JSON and JWT `app_metadata` are not actor authority.
4. Enforce any route role allowlist before service-role construction.
5. Construct the service-role client only after the preceding checks pass.

`requireAdminApiActor` and `requireOperationsActor` delegate to the same resolver. `revalidateCurrentApiActor` repeats the Auth identity and request-scoped profile lookup immediately before sensitive actions; it refreshes current role, organization, active/delete state, session ownership, and authorization version without constructing another service client. The shared service-role facility check reloads the current active profile role itself, proves the facility is in the current organization and is not deleted, and only then accepts an organization-wide role or a current nonrevoked `user_facility_access` grant. Callers do not pass a snapshotted role.

Facility-derived routes constrain the first service-role resource lookup to the actor's current organization, check current facility access before the sensitive operation, and revalidate actor plus facility immediately before care-plan approval, infection-control evaluation, witness credential verification, and provider calls. Google reply publication separately revalidates before refresh-token exchange, location resolution, publication, and final persisted status. The Google OAuth callback resolves a current owner and matches both state-bound user and organization before exchanging the provider code and again before saving tokens. Manual Google sync revalidates at each provider/read/insert boundary.

## Covered routes

- `POST /api/admin/profile`
- `PATCH /api/admin/operations/tasks/[id]/complete`
- `PATCH /api/admin/operations/tasks/[id]/start`
- `PATCH /api/admin/operations/tasks/[id]/defer`
- `PATCH /api/admin/operations/tasks/[id]/escalate`
- `PATCH /api/admin/operations/tasks/[id]/reinstate`
- `POST /api/admin/operations/tasks/bulk-complete`
- `POST /api/care-plans/[id]/approve`
- `POST /api/controlled-substance/verify-co-sign`
- `GET /api/executive/standup/[week]/pdf`
- `POST /api/infection-control/evaluate-outbreak`
- `POST /api/infection-control/evaluate-vitals`
- `POST /api/insurance/renewal-narrative`
- `GET /api/knowledge/document-audit`
- `POST /api/knowledge/obsidian-draft`
- `POST /api/med-tech/incidents`
- `GET`, `POST`, and `PATCH /api/pilot-feedback`
- `DELETE /api/reputation/integrations/google`
- `GET /api/reputation/integrations/status`
- `GET /api/reputation/oauth/google/callback`
- `POST /api/reputation/replies/[id]/post-google`
- `POST /api/reputation/sync/google`

Unexpected database/provider failures changed in this segment are logged through `logError` and return fixed client-safe messages instead of raw database or runtime detail.

## Regression matrix

| Case | Expected result |
|---|---|
| Missing cookie/bearer user | 401; service client is not constructed |
| Missing/revoked database session | 401 from migration-326 stale authorization; service client is not constructed |
| Stale authorization version | 401; service client is not constructed |
| Inactive or soft-deleted profile | 403/no current actor; service client is not constructed |
| JWT metadata says owner but current profile says nurse | Owner-only request denied from the current database role |
| Unexpected profile database error | Logged; fixed response contains no database detail |
| Current actor succeeds | Profile resolution occurs before service-client construction |
| Current facility access denied | Privileged action/provider is not invoked |
| OAuth state organization differs from current profile | Provider code exchange is not invoked |
| Current facility access disappears before sensitive action | Sensitive write/evaluator/provider is not invoked |
| Actor is demoted or disabled after the first successful check | Second request-scoped revalidation fails; mutation/provider is not invoked |
| Google sync DB/provider returns sentinel detail | Original is logged; route and per-account detail use stable categorized copy |
| Pilot-feedback ID belongs to another organization | Generic not-found result; update is not attempted |
| Controlled-count ID belongs to another organization/facility | Generic not-found result before witness verification |
| Nurse becomes a non-owning caregiver after a vitals record loads | Fresh role/ownership check denies evaluation; evaluator is not called |
| Operations owner becomes caregiver after task load while retaining facility access | Fresh mutation-scope check denies completion; direct mutation/RPC is not called |
| Foreign operations task ID | Organization-scoped initial read returns generic task not found |
| Service RPC receives stale claimed role or a no-longer-authorized actor | Locked current profile/facility/grant/task predicates reject atomically before task/audit mutation |
| Defer response is lost and the exact request retries | Stable request key returns the same committed replacement without duplicate task/audit rows |
| Exact defer retry arrives after deferred timestamp | Stored receipt is returned before new-request time validation |
| Brand-new defer is past or equal to current wall clock | Strictly rejected; no replacement or audit is created |
| Defer retries with changed payload | Payload hash conflict returns fixed 409 copy; no second replacement is created |
| Defer audit insert fails | Entire replacement/original/receipt transaction rolls back |

## Deliberately deferred surfaces

Machine-only routes preserve their existing secret/cron authority and were not converted to a user actor:

- `/api/cron/reputation/google-reviews`
- `/api/reports/scheduler`

The rounding route family obtains its privileged client indirectly through `src/lib/rounding/auth.ts`. It was identified during the service-role audit and is deferred from this direct-route subsegment because it is a separate shared authorization surface spanning fourteen rounding endpoints. It should receive the same migration-326 current-actor ordering in a dedicated follow-up without mixing its route-specific manager, assignee, and facility semantics into SYS-001B.

## Verification evidence

- Focused current-actor/route regressions: PASS, 88 tests across 14 files.
- Full Vitest: PASS, 507 files; 3,068 passed, 2 skipped, 0 failed. The missing TypeScript source-map warning is unchanged and nonfatal.
- Native PostgreSQL 17 full replay: PASS, all 329 migration files and 11 SQL probes. The SYS-001 probe rejects a current caregiver presented to the service RPC as owner without mutating the task, then accepts the restored current owner. Profile, facility, and grant rows are held with transaction row locks through completion.
- `npm run typecheck`: PASS.
- Scoped ESLint across all changed TypeScript route/helper files: PASS with zero warnings.
- `git diff --check`: PASS.
- Earlier pre-review `SYS-001B` segment gate: PASS at `test-results/agent-gates/2026-09-07T00-37-24-804Z-SYS-001B.json`.
- Final post-review `SYS-001B-REVIEW` segment gate: PASS at `test-results/agent-gates/2026-09-07T00-59-29-002Z-SYS-001B-REVIEW.json` (required hygiene, secret scanning, dependency audit, gitleaks, full lint, migration sequence, production build, and stress checks passed; Docker replay and non-UI design/axe checks were optional skips).
- Final operations/atomic-RPC replacement `SYS-001B-OPERATIONS` gate: PASS at `test-results/agent-gates/2026-09-07T01-21-38-027Z-SYS-001B-OPERATIONS.json` (10 passed, 0 failed, 3 optional skips; production build included).
- Final atomic-defer replacement `SYS-001B-ATOMIC-DEFER` gate: PASS at `test-results/agent-gates/2026-09-07T01-41-33-996Z-SYS-001B-ATOMIC-DEFER.json` (10 passed, 0 failed, 3 optional skips; production build included). The gate used `SKIP_PG_VERIFY=1` after an optional Docker replay hung for more than three minutes; its exact disposable container was stopped and removed. The separate native PostgreSQL 17 replay above is the authoritative database proof.
- Final hash/replay-order replacement `SYS-001B-ATOMIC-DEFER-FINAL` gate: PASS at `test-results/agent-gates/2026-09-07T01-51-14-305Z-SYS-001B-ATOMIC-DEFER-FINAL.json` (10 passed, 0 failed, 3 optional skips; production build included). Its optional Docker lane was deliberately skipped because the fresh native PostgreSQL 17 replay is authoritative.

## Deployment gates

SYS-001B depends on migration 326 and its exact `pgrst.db_pre_request=public.haven_assert_authorized_request` configuration. Deploying only these route changes without migration 326 still checks the current profile row and role, but does not provide the database pre-request proof for session ownership and `auth_claim_version` freshness.

After deploying the matched database and application versions, exercise signed user requests with disable, soft-delete, demotion, facility revoke, and session deletion while retaining the old token. Confirm every covered route fails before any provider action or privileged mutation. Then refresh/sign in and confirm the newly hooked numeric authorization version receives the intended current access.

## Mission alignment

**Pass at source level.** SYS-001B makes real-time database authority, facility boundaries, and human attribution precede privileged application actions. Operational alignment remains **risk** until migration 326 and this application build are deployed together and the hosted signed-token matrix passes.
