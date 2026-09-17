# COL-362 — QA: Super Admin Users create / invite / reset after #528

**Date:** 2026-09-16
**Branch:** `blewis/col-362-qa-super-admin-users-createinvitereset-after-528`
**Baseline:** `main` @ `cfc8fa04` (contains #528 `ed196d6f` + migration 387)
**Scope:** `POST /api/admin/users`, `POST /api/admin/users/[id]/reset-password`,
`POST /api/account/change-password`, `MustChangePasswordGate`, temp-password generation.

---

## 1. Root cause of Charlene's failure

Reconstructed from production (`manfqmasfqppukpobpld`), read-only.

| Time (UTC) | Event |
|---|---|
| 2026-08-19 19:54:49 – 19:55:11 | Bulk invite burst creates **15 Auth users**. No `user_profiles` rows written. |
| 2026-08-19 19:54:58.811654 | `celmore.homewoodalf@gmail.com` Auth user created (`invited_at`). Never accepted. |
| 2026-08-19 19:55:00.139199 | `user_facility_access` row `1c227b6c-…` granted — Homewood Lodge, `is_primary=true`, `granted_by=NULL`, `revoked_at=NULL`. |
| 2026-09-15 16:10:11.810182 | Admin runs Super Admin → Users → Create. `user_profiles` row `47060e71-…` **committed**. |
| 2026-09-15 16:10:11 (same request) | Grant `INSERT` raises **23505** on `idx_ufa_unique`. Route returns **500**. |
| 2026-09-15 16:10 → 17:34 | Retry returns **409 "Email already in use."** Charlene has no email and cannot sign in. |
| 2026-09-15 17:34:53 / 19:04:24 | Manual repair: `email_confirmed_at`, then first `last_sign_in_at`. |

**Defect 1 — silent invite skip.** Pre-#528 `route.ts` (`ed196d6f^`) treated "Auth user
already exists" as a success branch: `invitationSent = false` plus a metadata update, and
nothing else. No invite re-send, no temporary password, no `email_confirm`. Charlene's
account was left exactly as unusable as before the request, and the UI did not surface
`invitation_sent: false`.

**Defect 2 — non-idempotent grant (the actual 500).** The route ran a bare
`insert` into `user_facility_access`. `003_user_rbac.sql:51` defines
`CREATE UNIQUE INDEX idx_ufa_unique ON user_facility_access (user_id, facility_id) WHERE revoked_at IS NULL`.
Her August grant was still active → 23505 → 500 **after** the profile row was committed.
The "duplicate facility access" is a pre-existing active grant, not a duplicate in the payload.

**Enabler — still present on `main` after #528.** Auth user → profile → grants are three
unguarded sequential writes with no transaction and no rollback. #528 fixed both triggers
(`ensureUserFacilityAccessGrants`, `provisionAuthUserForAdminCreate`) but not the enabler:
`route.ts:341-343` still orphans the Auth user on profile-insert failure, and `:353-364`
still leaves a profile with no access on grant failure.

---

## 2. Production integrity counts — baseline, read-only

Captured 2026-09-16 against `manfqmasfqppukpobpld` before any change on this branch.

| Metric | Value |
|---|---|
| `profiles_total` | 19 |
| `profiles_active_not_deleted` | 15 |
| `profiles_no_active_facility_access` | 1 (`thomas.sikes@icloud.com`, owner — org-wide scope, not user-visible breakage) |
| `duplicate_active_ufa_pairs` | 0 |
| `auth_users_total` | 36 |
| `auth_users_without_profile` | **17** (15 from the 2026-08-19 burst + 2 legacy test accounts) |
| `profiles_without_auth_user` | 0 |
| `auth_users_never_signed_in` | 15 |
| `auth_users_unconfirmed_email` | 14 |
| `must_change_password_profiles` | 0 |
| `must_change_password_auth_meta` | 0 |

Charlene's record is healthy as of capture: 1 profile, 1 active grant, email confirmed,
`last_sign_in_at` set. The 17 orphaned Auth users are a pre-existing population that this
branch does not touch — filed separately.

---

## 3. QA matrix

`ACTUAL (main)` is the behaviour of `main` @ `cfc8fa04` — recorded **before** any fix on
this branch. `ACTUAL (branch)` is filled in after the fixes land.

| # | Case | Expected | ACTUAL (main) | ACTUAL (branch) |
|---|---|---|---|---|
| 1 | Create, new email, `send_invite=true` | Invite dispatched; `invitation_sent=true`, `provision_method=invite_email` | PASS | PASS |
| 2 | Create, new email, `send_invite=false` | Temp password returned once; `must_change_password` set in settings + app_metadata | PASS | PASS |
| 3 | Create, Auth user exists and has never signed in, `send_invite=true` (Charlene) | No silent skip — temp password issued, `email_confirm`, `invitation_sent=false` | PASS | PASS |
| 4 | Create, Auth user exists, confirmed and previously signed in, `send_invite=true` | Password-reset email dispatched; `invitation_sent=true`, `provision_method=password_reset_email` | PASS | PASS |
| 5 | Create where target already holds an **active** grant for that facility | Repeat grant is a no-op; 201, no 23505 | PASS | PASS — now a true no-op: zero writes issued |
| 6 | Create where target holds a **revoked** grant for that facility | Grant reactivated (`revoked_at` cleared, `granted_at` refreshed); 201 | PASS | PASS |
| 7 | Create with the same `facility_id` twice in `facilities[]` | Rejected at validation with a field error; never reaches the DB | **FAIL** | PASS — 422 before provisioning is called |
| 8 | Profile insert fails after an Auth user was **created in this request** | Auth user deleted; no orphan; 500 | **FAIL** | PASS — `rollback: "complete"`, `adminHardDeleteUser` called |
| 9 | Grant write fails after profile insert | Profile **and** any grants written in this request rolled back; no half-created user | **FAIL** | PASS — profile deleted, grants undone, `profile_created` no longer returned |
| 10 | Profile insert fails for a **pre-existing** Auth user | Auth user **not** deleted (cleanup only for users created in that request) | **FAIL (vacuous)** | PASS — `auth_user_created:false` suppresses the delete; verified on staging |
| 11 | Invite API errors, or returns a null user | Surfaced as a failure; never reported as sent | **PARTIAL** | PASS — null user and null envelope both throw a named error |
| 12 | Temp-password generator | Uniform over the alphabet; guaranteed character-class coverage; never logged | **FAIL** | PASS — rejection sampling, head/tail skew < 5% over 4000 samples; all four classes guaranteed |
| 13 | Temp-password / forced-change expiry boundary | At and after the expiry instant the temp credential is refused; strictly before it is accepted | **FAIL** | PASS — 72h TTL, inclusive boundary, missing deadline reads as expired |
| 14 | Forced change enforced on every route group and every non-exempt API | Redirect on all route groups; 403 from non-exempt API routes | **FAIL** | PASS — `src/proxy.ts` redirects (15 paths across all 7 groups); `requireCurrentApiActor` returns 403 `password_change_required` |
| 15 | Rate limiting and authorization on the credential endpoints | Repeated attempts throttled; non-super-admin denied on create and reset | **FAIL (rate limit)** / PASS (authz) | PASS — 5/15min on change-password (refunded on success), 10/15min per admin on reset; authz unchanged |

**Baseline on `main`: 6 of 15 PASS, 1 PARTIAL, 8 FAIL.**
**On this branch: 15 of 15 PASS.**

Rows 1–6 are exactly what #528 set out to fix, and they held. Every remaining row was an
enabler #528 left open, and each is now closed by a test that fails without the fix.

---

## 4. Staging smoke — 2026-09-16, Haven HFO Staging (`iwcnajanvjvynolltflw`)

Staging carries migration 387, `haven_current_shell_actor` exposes the flag, and
`idx_ufa_unique` is the partial index the failure depended on. Starting counts: 56
profiles, 58 Auth users.

Charlene's exact pre-state was reconstructed — an Auth user invited 28 days earlier and
never accepted, holding an **active** grant on a facility, with no profile — and both the
old and new grant paths were replayed against it.

| Step | Result |
|---|---|
| Pre-state built | 1 Auth user, 0 profiles, 1 active grant |
| **Pre-#528 bare `INSERT`** | **`23505 duplicate key value violates unique constraint "idx_ufa_unique"`** — the 2026-09-15 failure reproduced verbatim |
| Post-fix grant sequence | `no-op on existing row 39d01aaf-…` — lookup found the matching active grant, issued no write |
| Profile created | `must_change_password: true`, `must_change_password_expires_at: 2026-09-20T00:13:10.309Z`; the expression migration 387's RPC evaluates returns `true` |
| Rollback replay | Profile deleted; **Auth user retained**; the 28-day-old grant untouched (`granted_at` still `2026-08-20 00:12:41`) |
| Offboarded | 0 Auth rows, 0 profile rows, 0 grant rows. Counts back to 56 / 58. |

**What this smoke did not cover.** The HTTP-layer behaviour — the proxy redirect, the
API 403, and both rate limits — was not driven through a browser session on staging: the
Supabase CLI on this machine is authenticated to a different account than the one holding
the Haven projects, so no staging service-role or super-admin credential was reachable.
Those three are covered by unit tests that call the real route handlers and the real
`proxy()` export, not mocks of them. A browser pass on staging is still worth doing
before the forced-change flag is used in anger.

**Production was read only.** Counts re-checked after all work: 19 profiles, 36 Auth
users, 17 without a profile, 1 profile without active access, 0 duplicate pairs, 0
must-change flags — identical to the baseline in §2.

---

## 5. Gates

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 (ESLint `--max-warnings 0` + constitution lint, 30 files) |
| `npm run typecheck` | exit 0 |
| `npx vitest run` | exit 0 — **777 files, 5935 passed**, 2 skipped |
| `npm run migrations:check` | PASS — 414 migrations, sequence 001..411 |
| `npm run migrations:check:hosted` | PASS — no `public.`-qualified extension calls |
| `npm run migrations:verify:pg` | PASS — 414 migration files, 74 SQL probes, level parity (105 cases). Replayed on a throwaway **native** PostgreSQL 17 cluster, torn down after; no Docker. |
| `npm run build` | exit 0 |
| `npm run check:secrets` | PASS |
| `npm run secrets:gitleaks` | PASS — 2256 commits, no leaks |
| Client bundle sweep | clean across 686 chunks — no service-role key value or identifier, no `service_role` literal, no temp-password alphabet, no `generateSecurePassword`, no `adminSetMustChangePassword` |

No migration was added: the expiry rides in the existing `user_profiles.settings` jsonb
and Auth `app_metadata`, both already exposed by migration 387.

---

## 6. Findings filed separately

- 17 Auth users with no `user_profiles` row in production (15 from the 2026-08-19 bulk
  invite). Not touched by this branch — needs an owner decision on invite-or-purge.
- `thomas.sikes@icloud.com` (owner) holds zero `user_facility_access` rows.
- A browser-driven staging pass over the forced-change redirect and the two rate limits,
  once a staging credential is available to this workflow.
