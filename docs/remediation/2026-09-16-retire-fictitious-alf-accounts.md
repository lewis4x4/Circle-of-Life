# Retiring the fictitious `@circleoflifealf.com` accounts

**Date:** 2026-09-16
**Project:** `manfqmasfqppukpobpld` (pilot / production)
**Trigger:** owner ruling — every `@circleoflifealf.com` address was a fictitious
seeded persona and had to go. Surfaced while reviewing COL-438, whose
`duplicate_identity_candidates` count of 4 was entirely these accounts.

Note: `circleoflifealf.com` is also the **production site domain**. Only the
*email addresses* were fictitious. Every `https://circleoflifealf.com` URL in
`src/`, `scripts/release/haven-sys001.py` and the evidence JSON is the real site
and was deliberately left untouched.

## What was there

15 profiles, 13 of them still live (Carlos Rivera and Linda Chen had already been
soft-deleted in May). They authored almost nothing: **0 staff rows, 0 resident or
clinical records**, 37 facility grants, 9 `audit_log` rows, 2
`user_management_audit_log` rows.

No real person lost access. Every one of them already had an account on another
domain:

| Real person | Kept | Retired twin |
|---|---|---|
| Milton Smith | `msmith.gsms@gmail.com` (owner) | `milton.smith@circleoflifealf.com` |
| Jessica Murphy | `jessicamurphy@circleoflifecommunities.com` (org_admin) | `jessica.murphy@circleoflifealf.com` |

Brian Lewis, Charlene Elmore, Michelle Norris, Darren Webb and Thomas Sikes had
no twin on the domain and were not touched.

## What limited the blast radius

`audit_log.user_id -> auth.users` is `ON DELETE NO ACTION`, and `audit_log` is
immutable by design (CLAUDE.md data-layer non-negotiable #2 — no UPDATE or DELETE
policies). Four accounts signed April incidents and referral leads, so deleting
their `auth.users` row raises a foreign-key violation and the only way through
would be destroying audit history. They survive as banned, zero-grant tombstones:

| Account | `audit_log` rows | Outcome |
|---|---|---|
| `medtech@` (Maria Ochoa) | 4 | tombstone |
| `maria.garcia@` | 2 | tombstone |
| `milton.smith@` | 2 | tombstone |
| `admin@` (David Martinez) | 1 | tombstone |
| the other 11 | 0 | deleted outright |

Deleted outright: `broker@`, `coordinator@`, `dietary@`, `frontdesk@`,
`housekeeper@`, `james.thompson@`, `jessica.murphy@`, `linda.chen@`,
`maintenance@`, `robert.sullivan@`, `sarah.williams@`.

## What was run

```sql
-- 1. revoke every live facility grant held by a fictitious account (37 rows)
update public.user_facility_access ufa
set revoked_at = now(), revoked_by = null
where ufa.revoked_at is null
  and ufa.user_id in (select id from public.user_profiles where email ilike '%@circleoflifealf.com');

-- 2. retire the profiles (soft delete, per "soft deletes only")
update public.user_profiles
set is_active = false, deleted_at = coalesce(deleted_at, now())
where email ilike '%@circleoflifealf.com';

-- 3. kill live sessions and ban sign-in on all 15
delete from auth.refresh_tokens where user_id::uuid in (...);
delete from auth.sessions        where user_id in (...);
update auth.users set banned_until = timestamptz '2999-12-31 00:00:00+00' where id in (...);

-- 4. hard-delete the 11 with no audit history.
--    user_facility_access.user_id -> auth.users is NO ACTION, so grants go first;
--    user_profiles.id -> auth.users is CASCADE, so one delete removes both rows.
delete from public.user_facility_access where user_id in (<clean>);
delete from auth.users                  where id      in (<clean>);
```

Not a migration: this is data cleanup against one project, not a schema change,
and the fictitious rows never existed anywhere but the pilot.

## Verified after

- 15/15 profiles `is_active = false`, `deleted_at` set; 11 `auth.users` rows gone,
  4 banned until 2999.
- 0 live facility grants remaining on any of them.
- All 12 real accounts unbanned, not soft-deleted, grants intact.
- `haven.facility_identity_health` now returns `0 / 0 / 0` at all five facilities
  (was `0 / 4 / 0`).
- `npm run typecheck`, `npm run lint`, `npm run test` (766 files, 5735 tests) all pass.

## The resurrection vector, closed

`scripts/seed/repair-demo-auth.mjs` iterates `canonical-roster.mjs` and calls
`auth.admin.createUser` **with each entry's fixed UUID**, then resets the
password. Left alone it would have recreated all 11 deleted accounts on its next
run. (`marcus.bell@` had been in that roster for months with no `auth.users` row
at all, waiting to be created.)

`CANONICAL_ROSTER` is now empty, so `seed:repair` and `seed:verify` are both
no-ops and the dormant CI gate passes trivially.

## Scripts that carried persona defaults

All of these silently defaulted to a now-deleted account. Each now requires the
account to be named and exits `2` with a message pointing here:

| Script | Now requires |
|---|---|
| `scripts/a11y-authenticated.mjs` | `SCREENSHOT_USER_EMAIL` |
| `scripts/print-smoke.mjs` | `SCREENSHOT_USER_EMAIL` |
| `scripts/screenshot-dashboard.mjs` | `SCREENSHOT_USER_EMAIL` |
| `scripts/screenshot-caregiver-iphone-safe-area.mjs` | `SCREENSHOT_USER_EMAIL` |
| `scripts/visual-regression.mjs` | `SCREENSHOT_USER_EMAIL` |
| `scripts/homewood/rbac-verify.mjs` | `HOMEWOOD_RBAC_ACCOUNTS` (JSON by role) |
| `scripts/homewood/a11y-baseline.mjs` | `HOMEWOOD_A11Y_ACCOUNTS` (JSON by role) |
| `scripts/demo/authenticated-smoke.mjs` | `DEMO_SMOKE_ACCOUNTS` (JSON by role) |
| `scripts/demo/check-auth-diagnostics.mjs` | `DEMO_AUTH_EMAILS` (comma-separated) |
| `scripts/care-events/rls-check.mjs` | `CARE_EVENT_RLS_ACCOUNTS` (JSON by role) |
| `tests/homewood-launch/_helpers.ts` | `HOMEWOOD_LAUNCH_ACCOUNTS` (JSON by role; tests skip when absent) |
| `tests/care-events/_helpers.ts` | `CARE_EVENT_CAREGIVER_EMAIL` |

These feed CI jobs that are gated behind `vars.HAVEN_UI_GATES_ENABLED` and are
currently dormant — `Authenticated axe`, `Visual regression` and
`homewood-launch-tests` all report `skipping`. **Before that variable is flipped
on, the env vars above have to be populated with real accounts**, or those jobs
will fail on the first authentication.

Migrations 094, 161, 164, 165, 166, 170, 175 and 182 still contain the persona
addresses. They are applied history and were deliberately not edited.
