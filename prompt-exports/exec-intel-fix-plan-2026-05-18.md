# Plan: Make Executive Intelligence Overview come alive

**Date:** 2026-05-18
**Org:** COL (`00000000-0000-0000-0000-000000000001`) — 5 facilities including Homewood (`00000000-0000-0000-0002-000000000003`)
**User context:** "Connected, no live data has landed" empty state shown despite Homewood being fully seeded (residents, staff, rates, incidents, invoices).

## Root cause (confirmed)

1. **Table mismatch.** Executive Overview reads `exec_metric_snapshots` (v3 normalized, migration `096`). The `exec-kpi-snapshot` edge function writes to `exec_kpi_snapshots` (v1 JSON payload, migration `047`). **No production code writes to `exec_metric_snapshots`.** Only seeds did, and migration `231_retire_legacy_executive_demo_data.sql` soft-deleted those.
2. **Metric semantic gap.** Even if we wired dual-write, today's `_shared/exec-kpi-metrics.ts` doesn't compute `labor_pct`, `inc_rate`, or `survey_rd`, and `occupancyPct` is in 0-100 (the page expects 0-1). `rev_mtd` is currently "open balance due", not "billed MTD".
3. **No cron.** Neither `exec-kpi-snapshot` nor `resident-safety-scorer` has a `pg_cron` schedule.
4. **Deceptive empty-state CTAs.** The 4 numbered steps shown in `ExecutiveEmptyOnboarding` link to config pages (settings, rounding, alerts, thresholds). None actually invoke the snapshot. Following all 4 produces no change — exactly what the user experienced.
5. **Resident assurance widgets read base tables live** (no rollup table). `resident_safety_scores` is the only producer-driven source (via `resident-safety-scorer`). Watches/escalations/integrity flags will remain empty until real operational activity exists — that's correct behavior, but the UI copy shouldn't imply they're broken.

## Guardrails

- **Do not** un-soft-delete migration 231 rows — they were retired intentionally as demo data.
- **Do not** invent placeholder zeros for metrics that aren't yet computable from real data — let the UI render `—`.
- **Percentages stored as decimals** in `exec_metric_snapshots.metric_value_numeric` (0.891 = 89.1%). Currency in cents.
- **Idempotency:** before inserting normalized rows for the same `(org, snapshot_date, scope, metric_code)`, soft-delete the existing active row with `deleted_at = now()`. Don't hard-delete.
- **Auth:** any new "Run snapshot now" server action must verify owner/org admin server-side and derive `organization_id` from the role context; the cron-secret never leaves the server.
- **Edge function continues writing `exec_kpi_snapshots`** for back-compat — this is a dual-write, not a swap.

## Work items

### Item 2 — Wire exec-kpi-snapshot to populate `exec_metric_snapshots` and invoke for Homewood

**Goal.** Extend the edge function so each run produces normalized rows the overview can read. Then invoke for Homewood so KPI tiles + portfolio health table light up.

**Done when:**

- `_shared/exec-kpi-metrics.ts` has correct live formulas for the 5 dashboard codes:
  - `occ_pt` — active residents / total licensed beds, stored as decimal 0-1.
  - `rev_mtd` — sum of invoice `amount_billed` (or equivalent) for current month-to-date for the org, stored in cents.
  - `labor_pct` — labor cost (from time records / payroll) ÷ billed revenue MTD. Decimal 0-1. If labor cost rollup isn't available, omit the metric (don't fake it).
  - `inc_rate` — open + investigating incidents per 1,000 resident-days over the trailing 30 days. Numeric.
  - `survey_rd` — survey readiness composite (or omit if not computable from `survey_deficiencies` alone). If computable, decimal 0-1.
- `exec-kpi-snapshot/index.ts` dual-writes:
  - Existing insert into `exec_kpi_snapshots` (JSON payload) preserved.
  - **NEW:** for each scope (org-level with `facility_id IS NULL`, plus one row per facility), insert into `exec_metric_snapshots` with `metric_code` + `metric_value_numeric` + `status_color`. Soft-delete active rows for the same `(org, snapshot_date, facility_id, metric_code)` first.
  - Skip metrics that have no live formula (don't write fake zeros).
- After deploying the function, invoke it manually for the COL org. Verify `exec_metric_snapshots` has org-scope rows (`facility_id IS NULL`) and per-facility rows for Homewood.
- KPI tiles render real values; portfolio health table shows Homewood + 4 siblings with their per-facility metrics.

**Key files.**

- `supabase/functions/_shared/exec-kpi-metrics.ts` — extend metric computations.
- `supabase/functions/exec-kpi-snapshot/index.ts` — dual-write.
- `supabase/migrations/096_executive_intelligence_v3.sql` — schema reference.
- `src/types/database.ts` — type contracts for `exec_metric_snapshots`.

**Invocation (after deploy):**

```bash
curl -sS -X POST "https://manfqmasfqppukpobpld.supabase.co/functions/v1/exec-kpi-snapshot" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $EXEC_KPI_SNAPSHOT_SECRET" \
  -d '{"organization_id":"00000000-0000-0000-0000-000000000001"}'
```

**Status:** ✅ Code shipped & deployed. Blocked on user supplying `EXEC_KPI_SNAPSHOT_SECRET` to invoke against COL org. After invocation, verify `exec_metric_snapshots` rows for COL org + Homewood with the SQL at the bottom of this item.

---

### Item 3 — Run resident-safety-scorer for Homewood (+ optional 7-day backfill)

**Goal.** Populate `resident_safety_scores` for the COL org so the resident assurance heat map shows actual risk-tier counts.

**Done when:**

- `resident-safety-scorer` invoked for COL org. Rows appear in `resident_safety_scores` with `computed_by = 'edge:resident-safety-scorer'`.
- Heat map renders one row per facility with non-zero `criticalSafetyResidents` / `highOrCriticalSafetyResidents` counts (zero is acceptable if no resident scores high, but rows should appear).
- **Optional/stretch:** backfill ~7 days of synthetic historical safety_scores (running the scorer once per day with manipulated `computed_at`) so the 7-day trend chart shows bars. If too invasive, leave the trend chart empty for now — the dashboard already handles that gracefully.
- Empty watches/escalations/integrity flags are expected (no operational activity yet). Do not seed fake activity.

**Key files.**

- `supabase/functions/resident-safety-scorer/index.ts` — producer.
- `src/lib/resident-assurance/command-center-brief.ts` — consumer.

**Invocation:**

```bash
curl -sS -X POST "https://manfqmasfqppukpobpld.supabase.co/functions/v1/resident-safety-scorer" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $RESIDENT_SAFETY_SCORER_SECRET" \
  -d '{"organization_id":"00000000-0000-0000-0000-000000000001"}'
```

**Status:** ✅ Contract confirmed, no code changes needed. Blocked on user supplying `RESIDENT_SAFETY_SCORER_SECRET` to invoke against COL org. Backfill of historical scores deferred (would require duplicating scorer logic; acceptable — trend chart handles empty gracefully).

---

### Item 6 — Replace deceptive empty-state CTAs with a real "Run now" action

**Goal.** Eliminate the situation where the user follows 4 setup steps and nothing happens. The single primary action should actually invoke the snapshot.

**Done when:**

- `ExecutiveEmptyOnboarding` in `ExecutiveOverviewPageClient.tsx` redesigned:
  - One primary button: **"Refresh executive dashboard now"** (invokes both `exec-kpi-snapshot` and `resident-safety-scorer` server-side).
  - The 4 numbered steps demoted to a secondary "Configuration" list (no implication that they populate data).
  - Shows loading/success/error state; triggers a `router.refresh()` (or revalidation) on success so the page exits empty state in-place.
- New server action or API route (e.g., `src/app/api/admin/executive/refresh/route.ts`):
  - Requires authenticated owner/org admin.
  - Derives `organization_id` from server role context.
  - Calls the two edge functions with the cron secrets via server-only env vars.
  - Returns JSON status.
- Visible state when this action exists: empty install path is one click away from real data.

**Key files.**

- `src/components/executive/ExecutiveOverviewPageClient.tsx` — `ExecutiveEmptyOnboarding` component (lines 297-358).
- New `src/app/api/admin/executive/refresh/route.ts`.
- Existing role-auth pattern: see `loadFinanceRoleContextServer`.

**Status:** ✅ Shipped. New POST `/api/admin/executive/refresh` route (owner/org_admin auth, server-only secrets, sequential invocation). `ExecutiveEmptyOnboarding` redesigned: primary "Refresh executive dashboard now" button at top, original 4 steps demoted to secondary "Configuration" section with corrected wording. eslint + typecheck pass.

---

### Item 5 — pg_cron schedules

**Goal.** Keep the dashboard fresh without anyone clicking buttons.

**Done when:**

- New migration adds `pg_cron` schedules:
  - `exec-kpi-snapshot` — nightly at 02:00 UTC for each active organization (enumerate via SELECT or hard-code COL if intentionally single-tenant — confirm with user first if ambiguous).
  - `resident-safety-scorer` — every 6 hours per org.
- Follows the pattern in `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md` (existing AR aging, eMAR, missed-dose schedules).
- After deployment, verify cron rows exist with `SELECT * FROM cron.job`.

**Key files.**

- New `supabase/migrations/2026XXXX_schedule_exec_snapshot_and_safety_scorer.sql`.
- Reference: `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md` (lines 194-203).

**Status:** ⏸ Deferred — repo has no committed pg_cron migration pattern. Existing schedules (AR aging, eMAR, etc.) were set up manually in the production DB and only documented in `PHASE1-OPS-VERIFICATION-RUNBOOK.md`. User needs to either (a) add the same two schedules manually via Supabase dashboard / psql using the same pattern as existing jobs, OR (b) decide on a canonical migration template and commit it. The Refresh button (Item 6) covers immediate-action need; cron only matters for unattended freshness.

Verification SQL after manual setup:
```sql
SELECT jobid, schedule, command, active FROM cron.job
WHERE command ILIKE '%exec-kpi-snapshot%' OR command ILIKE '%resident-safety-scorer%';
```

---

### Item 1 — Verify dashboard renders live for Homewood

**Goal.** End-to-end smoke test after items 2/3/5/6 land.

**Done when:**

- Loading `/admin/executive` as a COL owner shows the live dashboard, not `ExecutiveEmptyOnboarding`.
- KPI strip shows non-`—` values for `occ_pt`, `rev_mtd`, and at least one other metric.
- Portfolio health table shows Homewood + 4 sibling facilities with per-facility values where computable.
- Resident assurance heat map shows 5 facility rows (counts may be 0; that's fine).
- 7-day trend either shows bars (if backfill done) or the existing empty-state message.
- "Refresh now" button (from item 6) actually changes the page state on click.
- No console errors.

**Status:** ☐ Pending

---

## Open coordination notes

- **Cron secrets** — confirm `EXEC_KPI_SNAPSHOT_SECRET` and `RESIDENT_SAFETY_SCORER_SECRET` exist in the Supabase project's edge-function secrets. If not, generate and document.
- **Single vs multi-tenant cron** — confirm with user whether to schedule for all active orgs or just COL. Default to "all active orgs" since the schema supports multi-tenant.
- **Jarvis Frontend Handoff** — owed at the end (per CORE standing instructions): list any new RPCs, type changes, or breaking query changes.
