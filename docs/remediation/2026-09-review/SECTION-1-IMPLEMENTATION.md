# Section 1 interface repairs and correction pass

Scope: NAV-001, NAV-006, BUS-005 and FL-009 only, on `codex/haven-section-1-interface-repairs`. Correction baseline: `ddb20fb6afc868b4fc646b325ada50f9945924f4`. All four entries remain `implemented_review_pending` until a fresh independent GPT-6 Astra High review approves them. No PR creation, merge, deployment or Section 2 work is authorized in this pass.

Mission alignment: **pass**. The corrections restore staff workflow reachability and unambiguous count identification while retaining facility scope, human counting, durable batch receipts and independent witness authorization. This is local engineering evidence, not clinical/customer sign-off or hosted acceptance.

## Superseded evidence

- `test-results/agent-gates/2026-09-07T19-18-53-400Z-section-1-interface-repairs.json`: retained failed gate. CountInitiationModal still supplied `medicationNames` after the shared receipt prop became `medicationLabels`; compilation failed and prevented UI checks.
- `test-results/agent-gates/2026-09-07T19-24-43-780Z-section-1-interface-repairs.json`: retained passing gate for the original implementation (11 passed checks, 2 optional skips). Its passing build and default-route UI checks did not prove the seven canonical routes, usable resident names, restored receipt identity, or a unique current mobile destination. Independent review requested the corrections below. The original full suite was 525 files, 3,159 passed, 2 skipped; those figures are historical, not the correction-pass result.

## NAV-001: real canonical routes

Seven `/admin` page wrappers re-export the existing page implementations:

- `/admin/finance/forecast`
- `/admin/finance/close`
- `/admin/finance/trust`
- `/admin/reports/history/[id]`
- `/admin/training/inservice/new`
- `/admin/transportation/requests/new`
- `/admin/transportation/requests/[id]`

The previous registry incorrectly treated `(admin)` route-group modules as `/admin` pages. The replacement test imports each actual canonical module, verifies that it exposes the existing implementation, and runs the configured legacy redirects through Next's path matcher/destination preparation. It verifies no second redirect follows the canonical destination.

`node scripts/verify-section-1-routes.mjs` is a required post-build check for this correction: all seven destinations must have exactly one normalized app module, its compiled file, production route registration and matching route regex, plus correct legacy redirect resolution without a second redirect. Missing build output is a failure, never a skipped assertion.

## NAV-006: one current permitted destination

The navigation chooses the most specific matching href from the role-filtered destinations. Overview is exact-match only. The same selected href governs primary links, More and the mobile drawer. Rendered tests open the real Sheet on Overview, Alerts, Standup history, nested history and Standup compare and verify one current link. Facility-admin and disallowed-role tests preserve filtering. Real canonical Overview/Alerts page integration tests open Sections and check that no desktop-only ancestor hides the trigger.

Evidence: `executive-hub-nav.test.tsx`, `executive-sections-pages.test.tsx` and the repaired supplemental source check. Rendered behavior is the primary regression proof.

## BUS-005: completed retry recovery

The certification regression now uses both rejected requests and plain PostgREST error responses. It verifies a second staff query with the same facility, active-employment and soft-delete filters; successful staff selection; a cleared error and enabled save action; and retention of category, credential name, issuing authority, issue date and expiration date. Separate rendered cases cover successful-empty after failure and repeated failure without displaying a false empty roster. The date regression awaits rendering and preserves an empty expiration date.

The certification implementation is unchanged in this correction pass. These tests make the eighth independent review probe durable and extend it to meaningful failure cases.

## FL-009: shared identity and saved-reference recovery

Both count entry points use one validation rule requiring a present resident and nonblank first and last legal names. Preferred name, middle name and suffix supplement the legal identity. Invalid identity prevents count entry and signing; a missing join is not silently discarded through an inner join.

Pending receipt identity is fetched by each saved `resident_medication_id`, within the count facility and under existing RLS, without the active-medication filter. Inactive medication records remain identifiable. Soft-deleted/inaccessible/missing records and retrieval failures block co-signing with a recovery error and an identity-only retry. Receipt readiness is bound to the facility and exact saved count set, so a stale asynchronous result cannot authorize a different receipt.

The existing batch-save helper, count receipt contract, independent co-sign API and database migrations remain unchanged. A saved batch is retained even when later identity resolution fails; retrying identity lookup does not insert another batch. Rendered tests cover full identity at both entry points and on saved receipts, blank legal names, null joins, inactive restored medications, failed/missing identity resolution and recovery, and unchanged count-save retry behavior.

## Correction verification

- Final focused regressions: **15 files, 106 passed, 0 failed**. Includes the eight review probes as durable tests; 29 rendered controlled-count cases, five certification cases, canonical route imports/redirects, navigation/page integration and unchanged batch/facility/co-sign authorization regressions.
- `npm run typecheck -- --incremental false`: **PASS** using `tsconfig.typecheck.json`.
- Full `npx vitest run`: **526 files, 3,210 passed, 2 skipped, 0 failed**. The two existing opt-in `HAVEN_PERF_BENCH` cases are synthetic standup processing and 1,000 roster timestamps; neither is a Section 1 regression. Existing unrelated asynchronous `act(...)` warnings remain in the suite.
- `git diff --cached --check`: **PASS**.
- Staged Gitleaks (`git --pre-commit --staged --redact`): **PASS**, no leaks (repeated after final evidence staging). The required gate also runs tracked-file secret scanning and repository-history Gitleaks.
- `node scripts/verify-section-1-routes.mjs`: **PASS**, all seven canonical modules, compiled route registrations and legacy redirect destinations.
- `npm run segment:gates -- --segment section-1-interface-corrections --ui`: **PASS**, 11 passed checks, 0 failures, 2 optional skips. Artifact: `test-results/agent-gates/2026-09-07T20-28-38-051Z-section-1-interface-corrections.json`. Required build, ESLint, environment hygiene, tracked secrets, npm audit, Gitleaks, migration sequence, stress, design and axe checks passed without advisory overrides.
- Optional skips: PostgreSQL migration replay because Docker is unavailable; secondary `apps/web` build because that package does not exist. No migrations changed.
- Design checked local `/` at 375, 768, 1024 and 1440 pixels (4 screenshots, no errors); axe checked local `/` (1 route). Both ran against the gate's newly built preview at `http://127.0.0.1:4310`. They do not claim authenticated Section 1 route coverage.
- Ledger comparison against `ddb20fb6`: exactly NAV-001, NAV-006, BUS-005 and FL-009 changed; all remain `implemented_review_pending`. Batch persistence helper, co-sign API and migrations have no diff.
- No failed correction-pass segment gate was produced. Both historical gate artifacts remain retained above. An exploratory bare `tsc` command included unrelated test/config typing debt; the required repository typecheck and production build both passed.

## Remaining limits

Tests use local fixtures and mocked database/authentication boundaries. No production resident data, live count, provider credentials, hosted RLS exploit, or named-user clinical UAT was used. The standard segment design/axe checks cover the local public route surface; authenticated Section 1 workflows are covered by rendered regressions and compiled route evidence, not claimed as authenticated browser certification. A fresh independent GPT-6 Astra High review remains required before approval.

## Changed files in this correction

- `docs/remediation/2026-09-review/SECTION-1-IMPLEMENTATION.md`
- `docs/remediation/2026-09-review/roadmap-status.json`
- `scripts/verify-section-1-routes.mjs`
- `src/app/(admin)/admin/finance/close/page.tsx`
- `src/app/(admin)/admin/finance/forecast/page.tsx`
- `src/app/(admin)/admin/finance/trust/page.tsx`
- `src/app/(admin)/admin/reports/history/[id]/page.tsx`
- `src/app/(admin)/admin/training/inservice/new/page.tsx`
- `src/app/(admin)/admin/transportation/requests/[id]/page.tsx`
- `src/app/(admin)/admin/transportation/requests/new/page.tsx`
- `src/app/(admin)/certifications/new/page.test.tsx`
- `src/app/(admin)/executive/executive-hub-nav.source.test.ts`
- `src/app/(admin)/executive/executive-hub-nav.test.tsx`
- `src/app/(admin)/executive/executive-hub-nav.tsx`
- `src/app/(admin)/executive/executive-sections-pages.test.tsx`
- `src/components/controlled-substance/ControlledCountConsole.tsx`
- `src/components/controlled-substance/controlled-count-entry-points.test.tsx`
- `src/components/controlled-substance/controlled-medication-identity.test.tsx`
- `src/components/medication/CountInitiationModal.source.test.ts` (removed; superseded by rendered entry tests)
- `src/components/medication/CountInitiationModal.tsx`
- `src/lib/medications/controlled-count-identity.ts`
- `src/lib/navigation/canonical-admin-route-registry.test.ts`
- `test-results/agent-gates/2026-09-07T20-28-38-051Z-section-1-interface-corrections.json`
