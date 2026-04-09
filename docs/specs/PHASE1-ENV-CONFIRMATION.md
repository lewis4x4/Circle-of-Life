# Phase 1 — environment confirmation (non-UI)

**Purpose:** Record **repo and CLI** checks for target Supabase alignment. **Dashboard-only** items (Pro, BAA, PITR) remain **owner-confirmed**.

**Last run (repo/CLI):** 2026-04-10 — `npm run migrations:check`: **117** migration files **001–117** in [`supabase/migrations/`](../../supabase/migrations/) — see [README.md](./README.md) (next migration **118**).

**Last run (remote):** Re-run `supabase migration list` after **`117`** (`supabase db push`); prior **PASS** was **001–116** on **`manfqmasfqppukpobpld`**. Re-run after each migration-adding PR before release.

**Edge Functions:** Inventory and secrets: [`supabase/functions/README.md`](../../supabase/functions/README.md) (**10** function folders). **`npm run demo:ops-status`** checks a **core** set of deployed slugs are **ACTIVE** on the linked project; confirm **`process-referral-hl7-inbound`** separately if you rely on Module 22 HL7 processing.

---

## Canonical project (specs)

| Field | Value |
|-------|--------|
| **Project URL (authoritative in repo)** | `https://manfqmasfqppukpobpld.supabase.co` — [README.md](./README.md) § Supabase Project |

**Owner:** Confirm `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` matches this host (never commit `.env.local`).

**Owner confirmation (2026-04-06):** Brian Lewis — active Supabase project **is** `manfqmasfqppukpobpld` (Authentication dashboard, PRODUCTION). Align local `.env.local` with `https://manfqmasfqppukpobpld.supabase.co` before any UAT.

---

## Migration alignment (local vs remote)

Command: `supabase migration list`

**Canonical ops flow:** [PHASE1-OPS-VERIFICATION-RUNBOOK.md](./PHASE1-OPS-VERIFICATION-RUNBOOK.md)

**Local repo (file count / sequence):** **PASS** — `migrations:check` reports **001–117** (2026-04-10).

**Remote (target Supabase project):** Apply **`117`** then confirm parity **001–117** (`manfqmasfqppukpobpld`). If a pull adds `118+`, run `supabase db push` (or CI) until this command shows parity again.

---

## Seeded users / facility / facility selector

- **Procedure:** [DEMO-SEED-RUNBOOK.md](./DEMO-SEED-RUNBOOK.md)
- **Status (2026-04-09):** Hosted Auth + migrations **`110`–`111`** cleared pilot JWT issuance for Track A **A1**; owner still verifies `user_profiles`, `user_facility_access`, family links, and **facility selector** on `/admin` for **PH1-P04** (single-facility pilot acceptable). If Auth regresses (`Database error querying schema`), see [PHASE1-AUTH-DEBUG-HANDOFF.md](./PHASE1-AUTH-DEBUG-HANDOFF.md).
- **Canonical probe:** `npm run demo:auth-check` captures current `auth/v1/settings`, pilot login results, legacy login results, and optional Admin API user inventory when `SUPABASE_SERVICE_ROLE_KEY` is available.
- **Compact status:** `npm run demo:ops-status` summarizes migration parity, required function inventory, and the current auth probe verdict in one JSON payload.
- **Local web health:** `BASE_URL=http://127.0.0.1:3001 npm run demo:web-health` checks local login reachability plus unauthenticated admin/caregiver/family redirect behavior.
- **Local smoke:** `BASE_URL=http://127.0.0.1:3001 npm run demo:auth-smoke` re-checks `PH1-A02` and `PH1-A03` against a fresh local app instance.

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
| PH1-P01 | **PASS** — owner confirmed project ref | Brian Lewis — 2026-04-06: active project `manfqmasfqppukpobpld`; confirm `.env.local` `NEXT_PUBLIC_SUPABASE_URL` still matches (not committed) |
| PH1-P02 | **PASS (2026-04-10)** | `supabase migration list` — **001–117** local/remote parity after **`117`** pushed (agent-verified); re-verify after future migration PRs |
| PH1-P03–P04 | — | Seed + facility selector UAT; current remediation scope is single-facility pilot |
| PH1-P05 | N/A until Storage uploads | — |
| PH1-P06 | — | Dashboard: Pro / BAA / PITR |
