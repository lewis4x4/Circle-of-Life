# Track C — Workflow hardening (C1–C5)

**Purpose:** Record what was implemented to move from “schema + basic UI” toward **repeatable, operator-grade workflows** with **Edge automation** and **documented run paths**.

**Status:** **CLOSED — engineering complete (2026-04-09)** — code + docs + gate artifact. **Not an open backlog:** deploying Edge Functions, secrets, and crons on a given Supabase project is **operations** ([Deploy checklist](#deploy-checklist-owner) below), not unfinished Track C scope.

**Gate artifact:** `test-results/agent-gates/2026-04-08T23-50-35-228Z-track-c-workflow-hardening.json` (`npm run segment:gates -- --segment "track-c-workflow-hardening" --no-chaos`).

---

## C1 — Billing and revenue

| Item | Implementation |
|------|----------------|
| AR aging automation (spec `ar-aging-check`) | Edge Function [`ar-aging-check`](../../supabase/functions/ar-aging-check/index.ts) — sets `invoices.status` to `overdue` when `due_date` &lt; today and status ∈ (`sent`, `partial`) with `balance_due` &gt; 0. |
| Monthly generation + idempotency | Existing [`generate-monthly-invoices`](../../supabase/functions/generate-monthly-invoices/index.ts) + shared billing logic. |
| Invoice ↔ cash / GL | Validated in app via [`src/lib/finance/auto-posting.ts`](../../src/lib/finance/auto-posting.ts) and [`src/lib/finance/post-to-gl.ts`](../../src/lib/finance/post-to-gl.ts); **manual reconciliation** remains owner finance process (SQL in Supabase or export). |

**Secret:** `AR_AGING_CHECK_SECRET` (header `x-cron-secret`).

---

## C2 — Medications / eMAR

| Item | Implementation |
|------|----------------|
| Schedule generation (`generate-emar-schedule`) | Edge Function [`generate-emar-schedule`](../../supabase/functions/generate-emar-schedule/index.ts) — inserts `emar_records` for active non-PRN meds with `scheduled_times` for the next N days (default 7, max 14), skipping duplicates. |
| Missed-dose check (`emar-missed-dose-check`) | Edge Function [`emar-missed-dose-check`](../../supabase/functions/emar-missed-dose-check/index.ts) — finds `scheduled` rows older than 2 hours; inserts **`exec_alerts`** (`source_module: medications`) with dedupe via `deep_link_path`. |

**Secrets:** `GENERATE_EMAR_SCHEDULE_SECRET`, `EMAR_MISSED_DOSE_SECRET`.

**Note:** Schedule times are built in **UTC** from date + `scheduled_times`; tighten to facility timezone in a future segment if needed.

---

## C3 — Referral → admission → discharge

| Item | Implementation |
|------|----------------|
| Traceable E2E path | Documented in [TRACK-C-LIFECYCLE-RUNBOOK.md](./TRACK-C-LIFECYCLE-RUNBOOK.md) (happy path + guard checks). |
| Code anchors | Admin routes under `src/app/(admin)/admin/referrals/`, `admissions/`, `discharge/` per [FRONTEND-CONTRACT.md](./FRONTEND-CONTRACT.md). |

No new DDL in this track segment.

---

## C4 — Family + audit operations

| Item | Implementation |
|------|----------------|
| Audit export | Existing [`export-audit-log`](../../supabase/functions/export-audit-log/index.ts) + admin UI `compliance/audit-export`; structured logs per observability spec. |
| Family scope | Enforced by RLS + shells; Track A matrix already owner-signed for pilot — deepen UAT per [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md) §D. |

---

## C5 — Executive operations

| Item | Implementation |
|------|----------------|
| KPI snapshots | Existing [`exec-kpi-snapshot`](../../supabase/functions/exec-kpi-snapshot/index.ts). |
| Alert production from metrics | Edge Function [`exec-alert-evaluator`](../../supabase/functions/exec-alert-evaluator/index.ts) — evaluates [`_shared/exec-kpi-metrics.ts`](../../supabase/functions/_shared/exec-kpi-metrics.ts) per facility; inserts `exec_alerts` for open incidents, high AR (&gt; $25k open balance due in cents), active infection outbreaks. Dedupes on unresolved title + facility. |

**Secret:** `EXEC_ALERT_EVALUATOR_SECRET`.

---

## Deploy checklist (owner)

1. Set secrets in Supabase **Edge Functions → Secrets** (see [supabase/functions/README.md](../../supabase/functions/README.md)).
2. Deploy all functions from the **Deploy** section of that README.
3. Register crons (Supabase or external) for: `ar-aging-check` (daily), `generate-emar-schedule` (daily), `emar-missed-dose-check` (every 30–60 min), `exec-alert-evaluator` (daily after KPI snapshot or independent).

---

## Mission alignment

**pass** — Hardening improves **auditability**, **timely clinical follow-up**, and **operator visibility** without bypassing RLS. **Residual risk** is **operational** (functions not deployed or crons not scheduled on a given project) and **Track A** UAT depth — not missing Track C code.
