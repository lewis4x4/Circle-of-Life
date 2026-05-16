# Homewood Lodge ALF — Launch Workflow Tests

Playwright integration tests for the 7 must-have launch workflows.

- **Spec dir:** `tests/homewood-launch/`
- **Config:** `playwright.homewood.config.ts`
- **Runner:** `npm run homewood:test-launch`
- **Environment:** real dev/staging Supabase, real Homewood accounts (the same canonical accounts the Sprint 2 auth verifier exercises)

## Running locally

```bash
# 1. Start a local Next.js server
npm run dev

# 2. In another shell, run the workflow tests
BASE_URL=http://127.0.0.1:3000 npm run homewood:test-launch
```

Required env (auto-loaded from `.env.local`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for cleanup + preconditions)
- `HOMEWOOD_LAUNCH_PASSWORD` (falls back to `PHASE1_DEMO_PASSWORD` for local convenience)

## What each test asserts

| # | File | Workflow | What we assert | Failure means |
|---:|---|---|---|---|
| 1 | `01-caregiver-shift.spec.ts` | Caregiver opens shift → ADL entry | Caregiver lands on `/caregiver`, sees resident assignments, can open an ADL form, save with a test marker, and the row persists in `adl_logs` | Caregiver workflow is broken or the ADL form / save endpoint regressed |
| 2 | `02-caregiver-incident.spec.ts` | Caregiver reports incident | Caregiver can submit a minor incident, the row lands in `incidents`, and a facility_admin signed-in in a second context can see it on `/admin/incidents` | Incident flow broken or admin visibility regressed |
| 3 | `03-medtech-medpass.spec.ts` | Med-tech med pass: given + refused | Med-tech can mark one med as given and another as refused; both decisions persist in `emar_records` | Med-pass workflow is broken — launch-blocker |
| 4 | `04-management-census.spec.ts` | Management views census | Facility_admin command center renders an active-resident count that matches the DB | Dashboard data layer is mis-wired |
| 5 | `05-management-careplan.spec.ts` | Management edits care plan | Facility_admin can edit a care-plan field; `version` bumps; original state restored in `finally` | Care-plan edit or versioning is broken |
| 6 | `06-family-portal.spec.ts` | Family logs in and views portal | Family account signs in, lands on `/family`, sees their linked resident's profile and recent activity | Family portal broken — affects 1823/contracts visibility post-launch |
| 7 | `07-owner-roster-drilldown.spec.ts` | Owner roster drilldown | Owner can scope to Homewood, view the resident roster, drill into a single resident | Owner-level navigation or RBAC scoping is broken |

## Idempotency + cleanup

Every test that mutates data:

1. Writes a free-text field containing `homewood-launch-test:auto` (exported as `TEST_MARKER`)
2. Has an `afterEach` (or `try/finally`) that deletes the marked rows or restores prior state
3. Skips with a clear message if Homewood doesn't have the data preconditions met (e.g. no active residents → can't test the caregiver shift workflow)

Running the suite twice in a row must not produce drift — the cleanup helpers are deterministic on the marker.

## Skip behavior — current Homewood state

As of `2026-05-16`, the Sprint 1 data audit shows Homewood has **0 active residents**. With the data gap in place, tests 1, 2, 3, 4, 5, 7 will skip with the "Homewood has 0 active residents" message. Test 6 will skip with "family account has no active resident links" (it currently has no rows in `family_resident_links` for the canonical family user). The tests are *correct in identifying the precondition gap* — they do not silently work around it.

Once residents are imported and family links provisioned, the suite should run end-to-end without modification.

## CI

`.github/workflows/homewood-launch-tests.yml` runs the suite on PRs touching `src/`, gated on `vars.HAVEN_UI_GATES_ENABLED` (dormant pre-launch). Once flipped, any test failure blocks merge.

## Selector strategy

Selectors are intentionally loose (regex on visible text + ARIA role queries) so that minor UI restyles don't break the tests. If a test breaks because a button label or heading changed, prefer updating the regex to keep the test resilient; only switch to `data-testid` if the regex becomes ambiguous.
