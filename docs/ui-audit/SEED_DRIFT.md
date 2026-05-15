# SEED_DRIFT.md

Ledger of demo / seeded auth accounts whose state has diverged from what the migrations describe. Each entry records:

1. The account
2. What's drifted (most often: password no longer authenticates with `HavenDemo2026!`)
3. The workaround that shipped in lieu of a fix
4. The PR / session where the workaround landed

Phase D will bundle the actual fixes (service-role admin password reset + migration replay if needed) into a single `chore(seed): repair demo auth fixtures` commit. Until then, this ledger is the source of truth so future contributors don't trip on the same drift twice.

## Active drift

### `milton.smith@circleoflifealf.com` — owner role

| Field | Value |
|-------|-------|
| Supabase user id | `a0000000-0000-0000-0000-000000000001` |
| Expected password | `HavenDemo2026!` (per `supabase/migrations/166_rebuild_demo_auth_with_triggers.sql`) |
| Observed | Password drifted; `signInWithPassword` returns `invalid_credentials` (was eventually repaired via service-role admin reset during Phase A audit — see `docs/ui-audit/OWNER_ROLE_FINDINGS.md`) |
| Status | Currently authenticatable — but the repair was ad-hoc and not codified in a migration |
| First reported | Phase A audit (owner-role episode) |

### `james.thompson@circleoflifealf.com` — caregiver role

| Field | Value |
|-------|-------|
| Supabase user id | `a0000000-0000-0000-0000-000000000005` |
| Expected password | `HavenDemo2026!` |
| Observed | Password drifted; `signInWithPassword` returns `invalid_credentials` |
| Workaround | Baseline captures used `maria.garcia@circleoflifealf.com` (also seeded as `caregiver`, password intact) |
| First reported | Phase C step 4 — caregiver baseline capture |

## Resolved drift

_(none yet — populated when Phase D ships the seed repair commit)_

## Repair plan (Phase D)

A single `chore(seed): repair demo auth fixtures` commit should:

1. Use the service-role admin API to reset each drifted account's password to the canonical `HavenDemo2026!`. (Or rotate per the GitGuardian discussion — see `.gitleaksignore` TODO header.)
2. Add a `scripts/seed/verify-auth-fixtures.mjs` smoke test that authenticates each seeded account at the canonical password. Run it as a CI gate.
3. Update this ledger: move each entry from "Active drift" to "Resolved drift" with the repair date.

The repair commit is intentionally NOT done during portal-PR scope because (a) it's an auth-credentials change, not a UI change, and (b) bundling it would dilute the PR-per-portal cadence that's worked so far.

## Why a ledger and not just a fix

Two prior agent passes "documented and moved on" with these drifts. Without a visible ledger, each new portal PR re-discovers the drift, picks a workaround, and adds another entry to an invisible mental backlog. The ledger makes the backlog explicit so it gets repaired in one shot.
