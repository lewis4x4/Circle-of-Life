# SYS-001C rounding authorization remediation

Status: source implemented and locally verified on 2026-09-06. Not deployed.

## Authority contract

All fourteen `src/app/api/rounding` route handlers now enter through the shared migration-326 current API actor contract. Signed identity is verified before the service-role client exists; current role and organization come from the active, nondeleted profile; stale authorization versions and missing/revoked sessions fail through the request-scoped profile read. Verified `session_id` and numeric-or-legacy authorization version claims are retained for actor-bound service commands. Rounding staff linkage is limited to the same organization and target facility, active employment, and a nondeleted staff row.

Manager-only routes apply the current manager role allowlist before privileged reads. Facility-parameter routes prove the current live facility and nonrevoked grant before reading domain records. ID-only task, escalation, integrity, watch, plan, and generation lookups are constrained to the actor's current accessible facility IDs, so a foreign tenant/facility identifier produces the same empty/not-found result instead of becoming an existence oracle.

Every mutating rounding handler revalidates session/version, current profile role/organization, active staff linkage, and live facility access immediately before mutation. Single-statement escalation, excuse, plan, and watch writes now use the request-scoped client, so migration 326's pre-request guard and current RLS execute at the actual statement boundary. Manager-only RLS now covers escalation updates, assignment releases, and watch-event inserts. Own-log exception/integrity inserts retain caregiver completion behavior without granting arbitrary facility writes.

Migration 326 adds a non-exposed internal rounding actor verifier. Service-only rounding commands lock and match the target facility, live grant, active profile, nondeleted/unbanned Auth user, owning `auth.sessions` row, authorization version, current role, and target-facility staff identity. The helper is not executable by API roles, including `service_role`; only the separately revoked and granted commands compose it.

- Generation validates every resident/plan/facility row and performs the existing conflict upsert only after locked manager authority.
- Completion locks the task and active assignment set, prefers the active assignment over a stale denormalized assignee, requires every manager to act through their own active target-facility staff identity, and atomically inserts the observation log, optional exception, and task finalization. A concurrent stale assignee or manager without staff leaves no log/task mutation.
- Reassignment locks task/current assignments and active target staff, then releases, records, and updates atomically. It accepts only `upcoming`, `due_soon`, `due_now`, `overdue`, `critically_overdue`, and already-`reassigned` work. Completed, late-completed, excused, and missed evidence is terminal. Although the live board's generic action drawer still displays `escalated` tasks, the Module 25 spec defines no reassignment transition from escalation, so the command fails closed for `escalated` instead of inventing one. Any non-allowlisted enum state or nonnull `completed_log_id` is rejected before staff, assignment, task, or audit mutation.
- Integrity assignment locks the flag and active target staff before applying current state transitions.
- Discovery revokes the browser-oriented one-argument RPC from `service_role`; its actor-bound overload additionally binds the current Auth user/session/version. The resident lock serializes retries and preserves one actor-attributed discovery plan.

Plan save now scopes an existing plan by both the submitted facility and current accessible facilities. Unknown, cross-organization, and inaccessible plan IDs all produce the same not-found result. Plan and rule `entity_id` values come exclusively from the validated facility row; request `entityId` is ignored.

## Covered routes

- escalation mutation
- task generation
- integrity-flag mutation and history
- plan list/save, template list, and discovery-default application
- completion reporting
- task list, completion, excuse, and reassignment
- vocabulary
- watch-instance mutation

## Verification evidence

- New current-authority, route-inventory, demotion/no-mutation, post-revalidation RLS denial, foreign-plan/entity injection, foreign-ID, facility-revoke, active-staff, manager-without-staff, concurrent-reassignment, terminal-reassignment, inactive-assignee, and grant-scope regressions: PASS, 46 tests across 6 files.
- Focused rounding/PWA regression: PASS, 254 tests across 26 files.
- Full Vitest: PASS, 513 files; 3,114 passed, 2 skipped, 0 failed. Existing React `act(...)`, nested-button, expected error-path logging, and missing TypeScript source-map warnings remain nonfatal.
- TypeScript typecheck: PASS.
- Scoped ESLint over the helper, all fourteen routes, and new tests: PASS with zero warnings.
- Native PostgreSQL 17.9 replay: PASS, 329 migration files and 11 SQL probes. The dedicated authorization probe uses a separate nonterminal task for successful reassignment and proves a completed task retains its status, `completed_log_id`, sole assignment, and audit count after rejection. It also rejects stale active-assignment completion and a manager without active staff without creating a log or changing the task; rejects terminated reassign/integrity targets; accepts current completion, reassignment, integrity, and generation commands; rejects another user's session at discovery; verifies exact discovery replay returns one actor-attributed plan; and verifies authenticated denial plus `service_role` allowance for every new public rounding command while the internal verifier remains unexecutable.
- `git diff --check`: PASS.
- Final replacement segment gate: PASS at `test-results/agent-gates/2026-09-07T03-21-07-794Z-SYS-001C-ROUNDING-FINAL.json` (required environment/secret checks, dependency audit, gitleaks, full lint, migration sequence, production build, and stress checks passed; duplicate Docker replay and non-UI design/axe checks were optional skips). The separate native PostgreSQL replay above is the authoritative database proof.

## Deliberate limits and hosted gates

This subsegment closes the rounding user-to-service-role authorization surface and makes completion core/reassignment atomic where authority and assignment must share row locks. It does not add a new completion request receipt or redesign the remaining multi-statement watch, plan-save rollback, or post-completion integrity-detection workflows. Migration 319 contains no rounding completion receipt command in this branch; broader failure/retry receipts remain SYS-003 data-integrity scope.

Deploy migration 326 and the matched application build together. Then use real signed tokens to repeat disable, soft-delete, demotion, facility revoke, session deletion, cross-organization/facility ID, manager/assignee, and discovery-plan lost-response replay cases. Source tests do not establish hosted PostgREST hook configuration, hosted Auth hook enablement, or production acceptance.

## Mission alignment

**Pass at source level.** Current human authority and facility scope now precede privileged rounding access and mutation. Operational alignment remains **risk** until the matched database/application deployment and hosted signed-token matrix pass.
