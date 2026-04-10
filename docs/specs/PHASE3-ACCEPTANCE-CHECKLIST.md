# Phase 3 acceptance checklist

**Authority:** [README.md](./README.md) Phase 3 modules — **17** Entity & Facility Finance, **18** Insurance & Risk Finance, **19** Vendor & Contract Management, **24** Executive Intelligence v1 (migrations `040`–`049`, executive `047` + Enhanced finance `048` / insurance `049`).

**How to use:** For each row, record **PASS** / **FAIL** / **N/A** with date, tester, and notes (screenshot, Supabase row proof, or issue link). **Pilot facility:** Oakridge ALF unless the row explicitly requires org-wide or multi-facility context.

**Demo mode:** `NEXT_PUBLIC_DEMO_MODE=true` opt-in only (sales). **Honest UAT** leaves it unset — executive/finance hubs must show empty/real states when data is missing.

**Deferred / Enhanced (not Core acceptance blockers):** Rich charting libraries on executive role dashboards (`/executive/ceo`, `/cfo`, `/coo`), additional NLQ/automation beyond shipped APIs — see [24-executive-intelligence.md](./24-executive-intelligence.md) Enhanced backlog.

---

## Mission alignment

**Pass criteria:** Work confirms **owner visibility**, **regulatory-ready traceability**, and **RLS-governed** finance/insurance/vendor/exec surfaces; AI features (renewal narrative) remain **human-reviewed** per spec.

| Verdict | Record when |
|---------|----------------|
| **pass** | Core rows below are PASS or waived with owner approval |
| **risk** | PASS with documented gaps in Enhanced tier only |
| **fail** | Core money/risk/exec path broken or demo data mistaken for production truth |

---

## Row map

| # | Criterion (summary) | Pass? | Notes |
|---|------------------------|-------|-------|
| 1 | **Module 17 — GL:** Chart of accounts, journal entries, posted ledger read-only, GL settings, budget vs actual — routes load; RLS respects org/facility scope | | `/admin/finance/*` |
| 2 | **Module 17 Enhanced (`048`):** Trial balance, posting rules, period close — create/view close period; posting blocked to closed period when data exists | | `/admin/finance/trial-balance`, `posting-rules`, `period-close` |
| 3 | **Module 18 — Insurance:** Policies, claims, renewals, COI — hub + detail routes; incident-linked claim path if seed data exists | | `/admin/insurance/*` |
| 4 | **Module 18 Enhanced (`049`):** Renewal packages, TCoR on hub, narrative API returns draft — **human review** before external use | | `/admin/insurance`, `POST /api/insurance/renewal-narrative` |
| 5 | **Module 19 — Vendors:** Directory, POs, invoices, payments, spend — list/detail flows; three-way match when lines exist | | `/admin/vendors/*` |
| 6 | **Module 24 — Executive v1:** Command center `/admin/executive` loads KPI tiles from `exec_metric_snapshots` / live aggregates; alerts list; reports saved; benchmarks cohort compare | | `/admin/executive`, `alerts`, `reports`, `benchmarks`, `settings` |
| 7 | **Executive drill-down:** Entity `/admin/executive/entity/[id]` and facility `/admin/executive/facility/[id]` — scope matches RLS | | |
| 8 | **Cron / Edge:** `exec-kpi-snapshot` documented; secret in Dashboard; manual or scheduled run produces `exec_kpi_snapshots` rows | | [supabase/functions/README.md](../../supabase/functions/README.md) |
| 9 | **No false production data:** With `NEXT_PUBLIC_DEMO_MODE` **unset**, empty DB shows empty/placeholder — not synthetic resident/incident/finance rows (WS1 gated pages) | | |
| 10 | **Meta:** This checklist row | | Owner sign-off row when 1–9 satisfied |

---

## Verification detail (by area)

### Finance (Module 17)

- Confirm at least one **posted** journal entry or ledger view for the org (or document empty state).
- Trial balance ties to chart for an open period (or N/A if no periods seeded).

### Insurance (Module 18)

- Open a policy record and a claim if seeded; otherwise document empty state and RLS deny for wrong org.

### Vendors (Module 19)

- Create or view PO → invoice → payment path **or** document which sub-routes are N/A on pilot data.

### Executive (Module 24)

- After snapshot cron or manual snapshot, KPI tiles differ from all placeholders; alerts respect `exec_alerts` RLS.

---

## Sign-off

| Field | Value |
|-------|--------|
| **Result** | PENDING |
| **Date** | |
| **Tester** | |
| **Notes** | |
