# Phase 1 — environment confirmation (non-UI)

**Purpose:** Record **repo and CLI** checks for target Supabase alignment. **Dashboard-only** items (Pro, BAA, PITR) remain **owner-confirmed**.

**Last run (repo/CLI):** 2026-04-05 — `npm run build` / `migrations:check`: **69** migration files **001–069** in [`supabase/migrations/`](../../supabase/migrations/).

**Last run (remote, documented):** 2026-04-06 — `supabase db push` applied **040** and **041**; `supabase migration list` showed Local/Remote aligned **001–041**. If the pilot project should match repo head (**069**), owner must run `supabase db push` and re-check `migration list`.

---

## Canonical project (specs)

| Field | Value |
|-------|--------|
| **Project URL (authoritative in repo)** | `https://manfqmasfqppukpobpld.supabase.co` — [README.md](./README.md) § Supabase Project |

**Owner:** Confirm `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` matches this host (never commit `.env.local`).

---

## Migration alignment (local vs remote)

Command: `supabase migration list`

**Local repo (file count / sequence):** **PASS** — `migrations:check` reports **001–069** (2026-04-05).

**Remote (target Supabase project):** **VERIFY** — Re-run `supabase migration list` after any `db push`. Historical record: **001–041** aligned on **2026-04-06**; **042–069** require owner push when pilot should track repo head.

---

## Seeded users / facility / facility selector

- **Procedure:** [DEMO-SEED-RUNBOOK.md](./DEMO-SEED-RUNBOOK.md)
- **Status:** Owner verifies `user_profiles`, `user_facility_access`, family links, and admin facility selector behavior on the target app — not automatable from this repo session.

---

## Production compliance (Supabase dashboard)

| Check | Where | Owner |
|-------|--------|-------|
| Pro plan | Billing / subscription | ☐ |
| BAA before PHI | Compliance / legal | ☐ |
| PITR enabled | Database settings / backups | ☐ |

---

## Summary for [PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md)

| ID | Repo/CLI result | Owner still required |
|----|-----------------|----------------------|
| PH1-P01 | CLI links; canonical URL documented | Confirm `.env.local` host = `manfqmasfqppukpobpld.supabase.co` |
| PH1-P02 | **PASS** (local sequence 001–069) | Remote: **VERIFY** `migration list` / `db push` to intended ceiling |
| PH1-P03–P04 | — | Seed + facility selector UAT |
| PH1-P05 | N/A until Storage uploads | — |
| PH1-P06 | — | Dashboard: Pro / BAA / PITR |
