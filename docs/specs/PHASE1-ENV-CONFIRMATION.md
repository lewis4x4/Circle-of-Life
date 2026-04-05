# Phase 1 — environment confirmation (non-UI)

**Purpose:** Record **repo and CLI** checks for target Supabase alignment. **Dashboard-only** items (Pro, BAA, PITR) remain **owner-confirmed**.

**Last run:** 2026-04-06 — `supabase db push` applied **040** and **041** to remote; `supabase migration list` shows Local/Remote aligned **001–041**.

---

## Canonical project (specs)

| Field | Value |
|-------|--------|
| **Project URL (authoritative in repo)** | `https://manfqmasfqppukpobpld.supabase.co` — [README.md](./README.md) § Supabase Project |

**Owner:** Confirm `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` matches this host (never commit `.env.local`).

---

## Migration alignment (local vs remote)

Command: `supabase migration list`

**Result (2026-04-06):** **PASS** — Local and remote both show **001 through 041** after `supabase db push` (deployed `040_entity_facility_finance.sql`, `041_journal_draft_soft_delete.sql`).

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
| PH1-P02 | **PASS** (CLI) | `supabase db push` 2026-04-06; list aligned 001–041 |
| PH1-P03–P04 | — | Seed + facility selector UAT |
| PH1-P05 | N/A until Storage uploads | — |
| PH1-P06 | — | Dashboard: Pro / BAA / PITR |
