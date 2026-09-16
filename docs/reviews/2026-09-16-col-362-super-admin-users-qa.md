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
| 1 | Create, new email, `send_invite=true` | Invite dispatched; `invitation_sent=true`, `provision_method=invite_email` | PASS | |
| 2 | Create, new email, `send_invite=false` | Temp password returned once; `must_change_password` set in settings + app_metadata | PASS | |
| 3 | Create, Auth user exists and has never signed in, `send_invite=true` (Charlene) | No silent skip — temp password issued, `email_confirm`, `invitation_sent=false` | PASS | |
| 4 | Create, Auth user exists, confirmed and previously signed in, `send_invite=true` | Password-reset email dispatched; `invitation_sent=true`, `provision_method=password_reset_email` | PASS | |
| 5 | Create where target already holds an **active** grant for that facility | Repeat grant is a no-op; 201, no 23505 | PASS | |
| 6 | Create where target holds a **revoked** grant for that facility | Grant reactivated (`revoked_at` cleared, `granted_at` refreshed); 201 | PASS | |
| 7 | Create with the same `facility_id` twice in `facilities[]` | Rejected at validation with a field error; never reaches the DB | **FAIL** — `createUserSchema` has no uniqueness rule; both entries pass and are replayed sequentially | |
| 8 | Profile insert fails after an Auth user was **created in this request** | Auth user deleted; no orphan; 500 | **FAIL** — `route.ts:341-343` returns 500 and leaves the Auth user orphaned | |
| 9 | Grant write fails after profile insert | Profile **and** any grants written in this request rolled back; no half-created user | **FAIL** — `route.ts:353-364` returns 500 with `profile_created: true`; half-created user persists and retry is blocked by the 409 | |
| 10 | Profile insert fails for a **pre-existing** Auth user | Auth user **not** deleted (cleanup only for users created in that request) | **FAIL (vacuous)** — no cleanup exists at all, so nothing is wrongly deleted, but the guarantee is unimplemented | |
| 11 | Invite API errors, or returns a null user | Surfaced as a failure; never reported as sent | **PARTIAL** — an `error` throws (`admin-client.ts:65-67`), but a null `data.user` throws a raw `TypeError` at `:88` and is reported as a generic 500 | |
| 12 | Temp-password generator | Uniform over the alphabet; guaranteed character-class coverage; never logged | **FAIL** — `admin-client.ts:39-44` is modulo-biased (61-char alphabet, `b % 61`, 256 mod 61 = 12 → first 12 chars 25% over-represented); no class guarantee | |
| 13 | Temp-password / forced-change expiry boundary | At and after the expiry instant the temp credential is refused; strictly before it is accepted | **FAIL** — no expiry concept exists | |
| 14 | Forced change enforced on every route group and every non-exempt API | Redirect on all route groups; 403 from non-exempt API routes | **FAIL** — `MustChangePasswordGate` is mounted only inside `HavenAuthProvider` (`haven-auth-context.tsx:212`), which `(med-tech)`, `(dietary)`, `(family)`, `(onboarding)` do not mount; no API enforcement at all | |
| 15 | Rate limiting and authorization on the credential endpoints | Repeated attempts throttled; non-super-admin denied on create and reset | **FAIL (rate limit)** — no throttle on `/api/account/change-password` (which calls `signInWithPassword` with attacker-supplied `current_password`, a password oracle) or on reset-password. **PASS (authz)** — create is `owner`/`org_admin`/`facility_admin`, reset is `owner`/`org_admin`, plus `canManageUser` / `canActorManageTarget` | |

**Baseline tally on `main`: 6 of 15 PASS, 1 PARTIAL, 8 FAIL.**

Rows 1–6 are exactly what #528 set out to fix, and they hold. Every remaining row is an
enabler #528 left open.

---

## 4. Findings filed separately

- 17 Auth users with no `user_profiles` row in production (15 from the 2026-08-19 bulk
  invite). Not touched by this branch — needs an owner decision on invite-or-purge.
- `thomas.sikes@icloud.com` (owner) holds zero `user_facility_access` rows.
