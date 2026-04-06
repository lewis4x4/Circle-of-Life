# Phase 1 — environment confirmation (non-UI)

**Purpose:** Record **repo and CLI** checks for target Supabase alignment. **Dashboard-only** items (Pro, BAA, PITR) remain **owner-confirmed**.

**Last run (repo/CLI):** 2026-04-06 — `npm run build` / `migrations:check`: **95** migration files **001–095** in [`supabase/migrations/`](../../supabase/migrations/).

**Last run (remote):** 2026-04-06 — `supabase db push` successfully applied **093**, **094**, and **095** to project `manfqmasfqppukpobpld`. `supabase migration list` now shows **Local | Remote** aligned **001 through 095**.

**Edge Functions (same session):** `export-audit-log`, `dispatch-push`, `generate-monthly-invoices`, and `exec-kpi-snapshot` deployed (`supabase functions deploy … --project-ref manfqmasfqppukpobpld`); bundles matched existing deployed versions (**No change found**).

---

## Canonical project (specs)

| Field | Value |
|-------|--------|
| **Project URL (authoritative in repo)** | `https://manfqmasfqppukpobpld.supabase.co` — [README.md](./README.md) § Supabase Project |

**Owner:** Confirm `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` matches this host (never commit `.env.local`).

---

## Migration alignment (local vs remote)

Command: `supabase migration list`

**Local repo (file count / sequence):** **PASS** — `migrations:check` reports **001–095** (2026-04-06).

**Remote (target Supabase project):** **PASS** (2026-04-06) — `migration list` Local/Remote **001–095**; `db push` up to date.

---

## Seeded users / facility / facility selector

- **Procedure:** [DEMO-SEED-RUNBOOK.md](./DEMO-SEED-RUNBOOK.md)
- **Status:** Live remediation attempted. Auth repair migrations **093**, **094**, and **095** are on the target project, but pilot sign-in still fails with `Database error querying schema`; owner still verifies `user_profiles`, `user_facility_access`, family links, and admin facility selector behavior once auth is repaired.

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
| PH1-P02 | **PASS** | `supabase migration list` now shows Local/Remote **001–095** (2026-04-06) |
| PH1-P03–P04 | — | Seed + facility selector UAT; current remediation scope is single-facility pilot |
| PH1-P05 | N/A until Storage uploads | — |
| PH1-P06 | — | Dashboard: Pro / BAA / PITR |
