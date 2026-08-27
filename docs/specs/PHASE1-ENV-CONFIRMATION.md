# Phase 1 — environment confirmation (non-UI)

**Purpose:** Record **repo and CLI** checks for target Supabase alignment. **Dashboard-only** items (Pro, BAA, PITR) are **owner-attested and closed (A5)** — see Production Compliance below. Do not treat A5 as unsigned.

**Last run (repo/CLI):** 2026-08-19 — `npm run migrations:check`: **319** files covering sequence **`001`–`316`** in [`supabase/migrations/`](../../supabase/migrations/) — see [README.md](./README.md) (next migration **`317`**). Timestamped Homewood files (`20260514*`) are present and replay-mitigated.

**Last run (remote):** Tracking repaired through **`316`** on 2026-08-19. Re-run `npm run migrations:verify:remote` after each remote apply. Do not use `db push` blindly on this project.

**Edge Functions:** Inventory and secrets: [`supabase/functions/README.md`](../../supabase/functions/README.md) — **37** function folders present (2026-08-19). **`npm run demo:ops-status`** checks a **core** set of deployed slugs are **ACTIVE** on the linked project; confirm **`process-referral-hl7-inbound`** separately if you rely on Module 22 HL7 processing.

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

**Local repo (file count / sequence):** **PASS** — sequence **001–316**, next free **317** (2026-08-19).

**Remote (target Supabase project):** Tracking + Command Center projection repaired through **`316`** on 2026-08-19. Re-verify with `npm run migrations:verify:remote` after any remote apply.

---

## Seeded users / facility / facility selector

- **Procedure:** [DEMO-SEED-RUNBOOK.md](./DEMO-SEED-RUNBOOK.md)
- **Status (2026-04-09):** Hosted Auth + migrations **`110`–`111`** cleared pilot JWT issuance for Track A **A1**; owner still verifies `user_profiles`, `user_facility_access`, family links, and **facility selector** on `/admin` for **PH1-P04** (single-facility pilot acceptable). If Auth regresses (`Database error querying schema`), see [PHASE1-AUTH-DEBUG-HANDOFF.md](./PHASE1-AUTH-DEBUG-HANDOFF.md).
- **Canonical probe:** `npm run demo:auth-check` captures current `auth/v1/settings`, pilot login results, legacy login results, and optional Admin API user inventory when `SUPABASE_SERVICE_ROLE_KEY` is available.
- **Compact status:** `npm run demo:ops-status` summarizes migration parity, required function inventory, and the current auth probe verdict in one JSON payload.
- **Local web health:** `BASE_URL=http://127.0.0.1:3001 npm run demo:web-health` checks local login reachability plus unauthenticated admin/caregiver/family redirect behavior.
- **Local smoke:** `BASE_URL=http://127.0.0.1:3001 npm run demo:auth-smoke` re-checks `PH1-A02` and `PH1-A03` against a fresh local app instance.
- **Bundled local probes:** `BASE_URL=… npm run demo:pilot-readiness` — optional **`PILOT_READINESS_AUTH_SMOKE_REAL=1`** adds **`demo:auth-smoke:real`** (see [PHASE1-OPS-VERIFICATION-RUNBOOK.md](./PHASE1-OPS-VERIFICATION-RUNBOOK.md), [TRACK-A-CLOSEOUT-ROADMAP.md](./TRACK-A-CLOSEOUT-ROADMAP.md)).

---

## Production compliance (Supabase dashboard)

| Check | Where | Owner |
|-------|--------|-------|
| Pro plan | Billing / subscription | ✅ Owner-confirmed 2026-05-11; **re-attested 2026-08-26** (Brian Lewis: taken care of) |
| BAA before PHI | Compliance / legal | ✅ Owner-confirmed 2026-05-11; **re-attested 2026-08-26** (Brian Lewis: taken care of) |
| PITR enabled | Database settings / backups | ✅ Enabled 2026-08-19 — GitHub Action [Enable Supabase PITR](https://github.com/lewis4x4/Circle-of-Life/actions/runs/32296769927) applied `pitr_7` after upgrading compute to `ci_small`. CLI confirm: `pitr_enabled: true`. **Owner re-attested 2026-08-26.** |

---

## Summary for [PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md)

| ID | Repo/CLI result | Owner still required |
|----|-----------------|----------------------|
| PH1-P01 | **PASS** — owner confirmed project ref | Brian Lewis — 2026-04-06: active project `manfqmasfqppukpobpld`; confirm `.env.local` `NEXT_PUBLIC_SUPABASE_URL` still matches (not committed) |
| PH1-P02 | **PASS (2026-04-21)** | `supabase migration list` — **001–193** local/remote parity after **`193`** pushed (re-verify remote after each migration PR) |
| PH1-P03–P04 | — | Seed + facility selector UAT; current remediation scope is single-facility pilot |
| PH1-P05 | N/A until Storage uploads | — |
| PH1-P06 | **PASS** — Pro + BAA (2026-05-11); PITR `pitr_7` on `ci_small` (2026-08-19); owner re-attested 2026-08-26 | — |
