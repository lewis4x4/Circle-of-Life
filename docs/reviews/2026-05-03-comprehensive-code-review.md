# Comprehensive Code Review — 2026-05-03

## Scope
Reviewed the Homewood-pilot-ready Circle-of-Life/Haven codebase after sandbox/demo operational data was cleared from Supabase. Focus areas:

- empty-production-data assumptions after reset
- API/service-role authorization patterns
- destructive demo/reset tooling risk
- Supabase/RLS/data reset posture
- build/gate readiness

## Agent delegation note
Five review agents were launched for UI, API/security, Supabase/data, tooling/tests, and architecture. The agent backend failed before producing reports, so findings below come from direct static review and verification checks in the primary session.

## Findings fixed in this pass

### 1. Pilot feedback route accepted arbitrary facility IDs
- Severity: High
- File: `src/app/api/pilot-feedback/route.ts`
- Risk: Any authenticated user could POST feedback tagged to a facility they cannot access, because the route used service-role insertion and trusted `facilityId` after validating only auth/profile.
- Fix: Added `serviceRoleUserHasFacilityAccess` check before inserting facility-scoped feedback. Added reviewer filter access checks for GET when non-org-wide users request `facilityId`.

### 2. Pilot feedback free text was unbounded
- Severity: Medium
- File: `src/app/api/pilot-feedback/route.ts`
- Risk: Unbounded title/detail/route/shell_kind values increase storage abuse and accidental PHI over-collection risk.
- Fix: Added conservative server-side max lengths for shell kind, route, title, and detail.

### 3. Demo reset script remained dangerous after Homewood pilot reset
- Severity: High
- File: `scripts/demo/reset-demo-data.mjs`
- Risk: Script performs hard deletes with service-role credentials. In a pilot environment, accidental execution against hosted Supabase could remove deterministic demo org/facility rows or fail mid-run while touching production-like data.
- Fix: Added explicit `HAVEN_ALLOW_DEMO_RESET=1` opt-in, additional `HAVEN_ALLOW_REMOTE_DEMO_RESET=1` for hosted Supabase URLs, and verification that the deterministic demo org/facility names match before destructive work proceeds.

## Verified current data posture
- Remote host verified as `manfqmasfqppukpobpld.supabase.co`.
- Active org: Circle of Life Assisted Living Communities.
- Active facilities: Grande Cypress, Homewood Lodge, Oakridge, Plantation, Rising Oaks.
- Homewood active ID: `00000000-0000-0000-0002-000000000003`.
- Verified zero rows across 105 operational/demo tables including residents, staff, census, meds/eMAR, care plans, incidents, financials, payroll, reports/generated snapshots, search/demo/task/risk rows.

## Remaining recommendations

1. Add route-handler tests for `src/app/api/pilot-feedback/route.ts` covering:
   - POST with inaccessible `facilityId` returns 404
   - GET with inaccessible `facilityId` returns 404
   - org-wide roles can filter any facility in org
   - title/detail truncation behavior

2. Create a first-class `scripts/pilot/homewood-readiness-check.mjs` that codifies the manual checks from `test-results/pilot-reset/` so readiness can be rerun without ad hoc scripts.

3. Move reset scripts behind a separate npm namespace or remove `demo:reset` from day-to-day package scripts while real data entry is underway.

4. Continue service-role audit route-by-route. The shared helpers are good, but every direct route using `createServiceRoleClient()` should prove auth, org, role, and facility scope before reads/writes.

5. Confirm Supabase BAA / Pro / backups / PITR in the dashboard before entering PHI.

## Mission alignment
Pass. The review supports a safe transition from demo/sandbox state into Homewood pilot real-data entry while preserving auditability, access controls, and operational readiness.
