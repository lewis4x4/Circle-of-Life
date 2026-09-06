# Phase 1 — environment confirmation (non-UI)

**Purpose:** Record **repo and CLI** checks for target Supabase alignment. **Dashboard-only** items (Pro, BAA, PITR) are **owner-attested and closed (A5)** — see Production Compliance below. Do not treat A5 as unsigned. A separate current-evidence refresh gates PHI rollout.

**Current integrated repo (2026-09-06):** `npm run migrations:check`: **328** files covering numbered sequence **`001`–`325`** in [`supabase/migrations/`](../../supabase/migrations/). Next free migration: **`326`**. Timestamped Homewood files (`20260514*`) remain present and replay-mitigated.

**Current remote ledger:** Recorded through **`318`**. Remediation migrations **`319`–`325`** remain pending. Re-run `npm run migrations:verify:remote` after each controlled remote apply. Do not use `db push` blindly on this project.

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

**Local repo (file count / sequence):** **PASS** — 328 migration files, numbered sequence **001–325**, next free **326** (2026-09-06).

**Remote (target Supabase project):** Ledger recorded through **`318`**. Apply remediation versions **`319`–`325`** in ascending order, then re-verify with `npm run migrations:verify:remote`.

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

## Post-closeout PHI-launch evidence refresh — 2026-09-06

The owner attestations from 2026-05-11 and 2026-08-26 remain the authoritative A5 closeout record. The September review did not independently inspect the current contract or authenticated dashboard settings. That evidence gap is **not proof that no BAA exists** and does not reopen A5.

Before PHI rollout, owner/legal must confirm the executed BAA's current coverage for the relevant organization and production project, the HIPAA add-on, vendor-required project controls, and PITR. Use the then-current [Supabase HIPAA project documentation](https://supabase.com/docs/guides/platform/hipaa-projects) and [shared responsibility documentation](https://supabase.com/docs/guides/deployment/shared-responsibility-model) during that review; do not infer current contract terms from plan name or PITR alone.

**Owner/legal evidence needed before PHI rollout (COL-5 refresh):** agreement counterparty; covered organization and production project; current BAA coverage; HIPAA add-on; required project controls; and current PITR status. Preserve each evidence item separately. If verified contrary evidence is found, update this file, `PHASE1-CLOSURE-RECORD.md`, `PHASE1-EXECUTION-LOG.md`, and `TRACK-A-CLOSEOUT-ROADMAP.md` atomically. Do not record “no BAA in effect” from absence of a local copy.

## Production compliance (Supabase dashboard; historical attestations)

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
