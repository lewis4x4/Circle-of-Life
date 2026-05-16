# SEED_DRIFT.md

Ledger of demo / seeded auth accounts whose state has diverged from what the migrations describe. Each entry records:

1. The account
2. What's drifted (most often: password no longer authenticates with `HavenDemo2026!`)
3. The repair (commit SHA + date)
4. Root cause

## How drift is caught now

A CI gate (`.github/workflows/ci-gates.yml` → "Seed roster auth verify" step) runs `npm run seed:verify` on every PR. The verify script authenticates every account in `scripts/seed/canonical-roster.mjs` against the pilot Supabase project and fails the build the first time any roster account doesn't authenticate with its expected role.

**Future drift is caught by the seed:verify CI gate, not by manual baseline-capture observation.** The two previous drifts in this ledger were each found by an audit phase tripping over a fallback workaround — the gate flips that around so drift surfaces at PR time.

When the gate fails, the repair path is:

```bash
npm run seed:repair   # uses SUPABASE_SERVICE_ROLE_KEY to reset roster to canonical
npm run seed:verify   # re-confirm
```

Then add an entry to this ledger under "Active drift" describing what drifted and why, and move it to "Resolved drift" once the repair commit lands.

## Active drift

_(none — D0a closed the two previously-active entries plus a third that the inventory audit surfaced)_

## Resolved drift

### `milton.smith@circleoflifealf.com` — owner role

| Field | Value |
|-------|-------|
| Supabase user id | `a0000000-0000-0000-0000-000000000001` |
| Expected password | `HavenDemo2026!` |
| First reported | Phase A audit (owner-role episode, [docs/ui-audit/OWNER_ROLE_FINDINGS.md](./OWNER_ROLE_FINDINGS.md)) |
| Repair | D0a — commit `<TBD on merge>` (`scripts/seed/repair-demo-auth.mjs`) |
| Root cause | `supabase/migrations/160_reset_demo_user_passwords.sql` and `166_rebuild_demo_auth_with_triggers.sql` both hash the literal string `'Sp33dy22'` instead of `'HavenDemo2026!'` (line 36 in each). This is a stray password from a different project that leaked into the seed via copy-paste. The migrations did set `encrypted_password` and create `auth.identities` rows, but the password they set was wrong. An ad-hoc service-role admin reset during Phase A corrected it for `milton.smith` but was never codified. D0a's `repair-demo-auth.mjs` codifies the admin-API reset for the whole roster idempotently. |

### `james.thompson@circleoflifealf.com` — caregiver role

| Field | Value |
|-------|-------|
| Supabase user id | `a0000000-0000-0000-0000-000000000005` |
| Expected password | `HavenDemo2026!` |
| First reported | Phase C step 4 — caregiver baseline capture had to fall back to `maria.garcia` |
| Repair | D0a — commit `<TBD on merge>` (`scripts/seed/repair-demo-auth.mjs`) |
| Root cause | Same as `milton.smith` — migration 166 set the wrong literal password (`'Sp33dy22'`). The Phase A ad-hoc service-role admin reset that repaired most accounts was never applied to `james.thompson`. He sat with the wrong password for ~6 weeks until D0a's roster sweep caught him. |

### `admin@circleoflifealf.com` — owner role (newly discovered during D0a inventory)

| Field | Value |
|-------|-------|
| Supabase user id | `a0000000-0000-0000-0000-000000000008` |
| Expected password | `HavenDemo2026!` |
| First reported | D0a — surfaced by the canonical-roster auth probe, NOT by an audit phase tripping over it. **The audit's prior ledger was incomplete:** the two known drifts were the ones we hit during baseline captures, but a third drifted account had been sitting silently because no audit phase ever tried to authenticate as `admin@`. The full inventory probe found it. |
| Repair | D0a — commit `<TBD on merge>` (`scripts/seed/repair-demo-auth.mjs`) |
| Root cause | Same as `milton.smith` and `james.thompson` — migration 166 set the wrong literal password (`'Sp33dy22'`). Like james.thompson, never got the ad-hoc Phase A repair. |

### `marcus.bell@circleoflifealf.com` — dietary role (newly discovered, missing user)

| Field | Value |
|-------|-------|
| Supabase user id | `a0000000-0000-0000-0000-000000000016` |
| First reported | D0a — surfaced by the canonical-roster auth probe |
| Repair | D0a — commit `<TBD on merge>` (`scripts/seed/repair-demo-auth.mjs` CREATED the user with the canonical password) |
| Root cause | `supabase/migrations/175_seed_dietary_demo.sql` attempts to create `marcus.bell` (Lead Cook) but the live pilot project shows no corresponding row in `auth.users`. The migration likely failed partially or rolled back; the SQL never produced a row. Now created idempotently via the repair script. |

### `housekeeper@circleoflifealf.com` — housekeeper role (transient corruption during D0a)

| Field | Value |
|-------|-------|
| Supabase user id | `a0000000-0000-0000-0000-000000000015` |
| First reported | D0a — initial roster mapped this ID to `frontdesk@` based on a guess from migration 166's `a0000000-…-NN` numbering pattern, and the first repair run clobbered the housekeeper account's role + full-name. Caught immediately on re-probe; corrected by updating the roster from observed live state instead of inferred migration order. The repair script is now driven by observed reality, not a numbering guess. |
| Repair | D0a — same commit (`scripts/seed/repair-demo-auth.mjs` role-fix from `admin_assistant` → `housekeeper`, full-name from "Demo Front Desk" → "Rosa Alvarez"). |
| Root cause | An overly-confident initial canonical roster. Migration 166 numbers users `a0000000-…-NN` but the live project's IDs don't perfectly follow the migration's ordering — `frontdesk@` is at a random UUID assigned by a later seed pass (`0d8a23fd-…`), `housekeeper@` is at slot 15, and there is no slot 13. The roster is now built from the live `auth.admin.listUsers()` output instead of a migration-order inference. |

## Robert Sullivan (legacy artifact — NOT in canonical roster)

| Field | Value |
|-------|-------|
| Supabase user id | `a0000000-0000-0000-0000-000000000006` |
| Currently | `app_role: owner`, doesn't authenticate with `HavenDemo2026!` |
| Seeded by | Migrations 033 / 093 / 094 (early Oakridge demo data) |
| Status | **Deprecated — not in `CANONICAL_ROSTER` and not CI-gated.** Originally a "family" demo user; a later migration changed `app_role` to `owner` for reasons not documented in the migration history. The audit does not use this account. If a future audit phase actually needs `robert.sullivan`, add him to the roster and run `seed:repair` — the script will reset his password and confirm his email idempotently. |

## Inventory summary (post-D0a)

15 accounts in `CANONICAL_ROSTER` — every one authenticates with `HavenDemo2026!` against its expected `app_role`:

| Role | Email | Full name | Shell |
|------|-------|-----------|-------|
| owner | milton.smith@circleoflifealf.com | Milton Smith | /admin |
| owner | admin@circleoflifealf.com | David Martinez | /admin |
| facility_admin | jessica.murphy@circleoflifealf.com | Jessica Murphy | /admin |
| coordinator | coordinator@circleoflifealf.com | Natalie Foster | /admin |
| admin_assistant | frontdesk@circleoflifealf.com | Jessica Lawson | /admin |
| broker | broker@circleoflifealf.com | Angela Brooks | /admin |
| maintenance_role | maintenance@circleoflifealf.com | Carlos Rivera | /admin |
| nurse | sarah.williams@circleoflifealf.com | Sarah Williams | /admin |
| caregiver | maria.garcia@circleoflifealf.com | Maria Garcia | /caregiver |
| caregiver | james.thompson@circleoflifealf.com | James Thompson | /caregiver |
| housekeeper | housekeeper@circleoflifealf.com | Rosa Alvarez | /caregiver |
| med_tech | medtech@circleoflifealf.com | Maria Ochoa | /med-tech |
| dietary | dietary@circleoflifealf.com | Patricia Nguyen | /dietary |
| dietary | marcus.bell@circleoflifealf.com | Marcus Bell | /dietary |
| family | linda.chen@circleoflifealf.com | Linda Chen | /family |

## Lessons

- **The audit was vulnerable to silent drift in unused-but-seeded accounts.** Two of the three drifted accounts were caught by audit phases tripping over them. The third (`admin@`) was never used by an audit phase and only surfaced when D0a probed the whole roster. Without the verify gate, it would have stayed broken indefinitely.
- **Migration-order is not a substitute for observed reality.** D0a's initial roster mapped IDs based on migration 166's numbering convention. The live project doesn't follow that convention strictly (`-13` doesn't exist; `frontdesk@` has a random UUID; `housekeeper@` is at `-15`). Building inventory from `auth.admin.listUsers()` output instead of from migration source code avoids this class of bug. The corruption was caught immediately because re-probe is cheap; future inventory updates should follow the same observe-first rule.
