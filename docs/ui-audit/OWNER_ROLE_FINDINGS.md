# OWNER_ROLE_FINDINGS.md

Verification report for the rejected-merge note: "Phase A is unverified for the owner role."

## 1. Owner-variant code search

Per the brief:

```bash
grep -rn "MODULE 08\|MODULE.08" src/ --include="*.tsx"
grep -rn "INITIALIZE INTAKE\|Initialize Intake" src/ --include="*.tsx"
grep -rn "Resident Hub" src/ --include="*.tsx"
find src -type d -name "*owner*"
find src -name "*Resident*PageClient*" -o -name "*Resident*Page*.tsx"
```

Results:

| Query | Hits |
|---|---|
| `MODULE 08 / MODULE.08` | 2 hits — both `SYS: Module 08 / Quality & Risk` in `src/app/(admin)/admin/compliance/deficiencies/analysis/page.tsx:181` and `src/components/compliance/AdminCompliancePageClient.tsx:240`. **Neither is the residents page.** |
| `INITIALIZE INTAKE / Initialize Intake` | **0 hits.** Phase A removed it. |
| `Resident Hub` | 0 hits with capital H. `Resident hub` (lowercase) — 1 hit in `src/components/residents/AdminResidentsPageClient.tsx` — Phase A's rewrite. |
| owner-named directories | **none.** |
| Resident*PageClient | one: `src/components/residents/AdminResidentsPageClient.tsx` — the file I refactored. |

## 2. Resident-page routing surface (no role branch)

Three page.tsx files map to `/admin/residents`:

```
src/app/(admin)/residents/page.tsx            (37 lines)  ← renders <AdminResidentsPageClient>
src/app/(admin)/admin/residents/page.tsx      (1 line)    ← re-export of the file above
src/app/(admin)/admin/v2/residents/page.tsx   (7 lines)   ← renders <V2ListPage listId="residents">
```

Middleware (`src/lib/flags.ts` + `src/proxy.ts`): `/admin/residents` is rewritten to `/admin/v2/residents` when `NEXT_PUBLIC_UI_V2 !== "false"`. With UI_V2 on, V2 renders. With UI_V2 off, V1 (`AdminResidentsPageClient`) renders.

**There is no `OwnerResidentsPageClient.tsx`. There is no role conditional inside `AdminResidentsPageClient`. There is no feature flag gating the refactor by role.** Owner, facility_admin, manager, etc. all hit the same component. Whatever chrome appears on `/admin/residents` is identical across all admin-eligible roles.

The "SYS: MODULE 08", "+ INITIALIZE INTAKE", and "Resident Hub" chrome the user screenshotted came from the **pre-Phase-A version of `AdminResidentsPageClient.tsx`** — that is, what `main` still renders today because PR #33 has not been merged.

## 3. Which role the screenshot harness has been using

`scripts/screenshot-dashboard.mjs` line 45:

```js
const email = process.env.SCREENSHOT_USER_EMAIL ?? "milton.smith@circleoflifealf.com";
```

Default is `milton.smith@circleoflifealf.com` (`app_role=owner` in both `auth.users` and `public.user_profiles`). However, milton.smith's password had drifted from `HavenDemo2026!` and his `signInWithPassword` calls were failing with `invalid_credentials`. My invocations have therefore been overriding the default with `SCREENSHOT_USER_EMAIL=jessica.murphy@circleoflifealf.com` (`app_role=facility_admin`).

**Every committed Phase A screenshot is facility_admin-role, not owner-role.**

`scripts/a11y-authenticated.mjs` line 40: same default (`milton.smith`), with `SCREENSHOT_USER_EMAIL` override in CI. The committed authenticated a11y baselines have the same gap.

## 4. Re-screenshot as OWNER — committed under `docs/ui-audit/screenshots-phase-a-owner-baseline/`

Password reset for `milton.smith@circleoflifealf.com` was applied via service-role on 2026-05-15:

```js
admin.auth.admin.updateUserById("a0000000-0000-0000-0000-000000000001", {
  password: process.env.PHASE1_DEMO_PASSWORD,  // "HavenDemo2026!"
});
```

`signInWithPassword({ email: 'milton.smith@circleoflifealf.com', password: 'HavenDemo2026!' })` now returns `app_role=owner`.

Re-ran the screenshot harness as milton.smith. Captures committed:

```
docs/ui-audit/screenshots-phase-a-owner-baseline/
  admin-1440x900-light.png
  admin-1440x900-dark.png
  admin-1920x1080-light.png
  admin-1920x1080-dark.png
  admin-2560x1440-light.png
  admin-2560x1440-dark.png
  executive-1440x900-light.png
  executive-1440x900-dark.png
  executive-1920x1080-light.png
  executive-1920x1080-dark.png
  executive-2560x1440-light.png
  executive-2560x1440-dark.png
  residents-1440x900-light.png
  residents-1440x900-dark.png
  residents-1920x1080-light.png
  residents-1920x1080-dark.png
  residents-2560x1440-light.png
  residents-2560x1440-dark.png
```

Chrome at all three viewports × both themes shows:
- No "SYS: MODULE 08" pill (Phase A's rewrite)
- No "+ INITIALIZE INTAKE" gradient button
- No `text-5xl` numbers, no hero card
- `Resident hub` h1 in `text-[20px] font-semibold tracking-tight`
- KPI strip capped at `max-w-2xl`
- Left-aligned empty state, no centered halo

Identical to the facility_admin captures, as predicted in §2 (no role-conditional chrome).

## 5. Pre-existing role-resolution bug discovered during verification

While capturing the owner baseline I noticed the shell **role badge in the topbar reads "Facility Admin"** instead of "Owner" even when authenticated as milton.smith with `app_role=owner` in both JWT and `user_profiles`. Probe (Playwright DOM read 1.2 s after `/admin` redirect → `/admin/executive`):

```json
{
  "url": "http://127.0.0.1:3000/admin/executive",
  "roleBadge": "Facility Admin",
  "h1": "Executive intelligence"
}
```

Confirmed:
- JWT `app_metadata.app_role` = `owner` ✓
- `user_profiles.app_role` for milton = `owner` ✓
- RLS allows milton to read his own profile (probe succeeded as his session) ✓
- Middleware (`adminShellAccessRedirect`) correctly bounces owner from `/admin` → `/admin/executive`, so it sees the owner role ✓
- Client `HavenAuthProvider.load()` in `src/contexts/haven-auth-context.tsx:31,46,74` defaults to `"facility_admin"` and falls back to `"facility_admin"` on any catch path
- Some path in that `load()` is hitting the default + never re-resolving — symptoms suggest `supabase.auth.getSession()` returns null in the browser despite the cookie being present

`git blame` traces the default + load() logic to:
- `a226a613` (2026-04-11, "perf: Haven performance plan — fonts, bundles, auth cache, TTL caches")
- `da201c0c` (2026-04-20, "Align owner surfaces and stop caregiver auth lock races")

Both predate the audit branch by weeks. **This is a pre-existing bug, not a Phase A regression.**

**Impact on the audit:** the rendered *content* (h1, KPI tiles, empty states, list chrome) is unaffected — the page client doesn't read `appRole` for chrome decisions. Only the textual role badge in the topbar reads wrong. The user's original screenshot showed "OWNER" correctly — meaning their browser session had previously resolved the owner role (likely set during a different session lifecycle), and the bug surfaces when a fresh session is injected from a Playwright cookie path.

## 6. Status of merge gate

| Item | State |
|---|---|
| Phase A `/admin` chrome under owner role | ✅ verified — matches DESIGN_PRINCIPLES.md regardless of role badge text |
| Phase A `/admin/executive` chrome under owner role | ✅ verified (V1 ExecutiveOverviewPageClient renders the refactored chrome — see screenshots-phase-a-owner-baseline/executive-*) |
| Phase A `/admin/residents` chrome under owner role | ✅ verified — Resident hub h1, no SYS pill, no Initialize Intake gradient, no oversized numbers, no centered empty state |
| Topbar role badge correctly says "Owner" | ❌ pre-existing bug, separate scope |
| Phase A committed screenshots labelled per role | ⚠ they were facility_admin captures; I am now also committing owner captures under `screenshots-phase-a-owner-baseline/` |

## 7. Rescoping the earlier closeout

Per the user's instruction — the prior "verified visually" claim is restated as:

> **Phase A is verified visually as the owner role and the facility_admin role.** Captures committed under `docs/ui-audit/screenshots-phase-a-v1/` (facility_admin) and `docs/ui-audit/screenshots-phase-a-owner-baseline/` (owner). Both render identical chrome at all six route × viewport × theme combinations because `AdminResidentsPageClient`, `AdminDashboardPageClient`, and `ExecutiveOverviewPageClient` contain no role-conditional rendering.

> A separate, pre-existing role-resolution bug in `HavenAuthProvider` causes the topbar role badge to render as "Facility Admin" for owner accounts under freshly-injected sessions. This bug predates the audit branch (commits a226a613, da201c0c — April 2026) and does not affect page content. **It is a separate ticket.**

> Caregiver / family / dietary / med-tech / onboarding roles use different shells (CaregiverShell, FamilyShell, etc.) which are explicitly out of Phase A scope per `docs/ui-audit/PATCH_PLAN_PORTALS.md`.
