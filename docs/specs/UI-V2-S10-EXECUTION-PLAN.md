# UI-V2 Slice S10 — W3 + W4 Analytics + Forms

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §5 (T4, T5) + §6 (routes 3, 9, 15, 23, 26, 28, 29, plus finance) + §9 W3 & W4 gates
**Depends on:** S9 committed
**Est. eng-days:** 6

## Goal

Analytics pages and form pages migrated. Export pipeline (CSV/XLSX/PDF) works from one Edge Function. RHF+Zod enforced on all V2 forms.

## Routes migrated

### T4 Analytics (charts-first)

| V1 route | Dashboard ID |
|---|---|
| `/admin/executive/standup` | `executive-standup` |
| `/admin/executive/facility/[id]` | `facility-deep-dive` |
| `/admin/executive/reports` | `executive-reports` |
| `/admin/executive/benchmarks` | `executive-benchmarks` |
| `/admin/finance` (hub) | `finance-hub` |
| `/admin/finance/ledger` (labor analytics proxy) | `finance-labor` |
| `/admin/finance/trial-balance` (revenue proxy) | `finance-revenue` |

### T5 Forms

| V1 route | Form |
|---|---|
| `/admin/residents/new` | New Resident |
| `/admin/admissions/new` | New Admission |
| `/admin/residents/[id]/care-plan` | Care Plan Edit (rich form) |
| `/admin/incidents/new` | New Incident |

11 pages total. This is the biggest slice — allocate a full week.

## Files to deliver

### Per T4 page

- `src/app/(admin)/v2/<seg>/page.tsx` — uses `<T4Analytics />`.
- `src/app/(admin)/v2/<seg>/loading.tsx`, `error.tsx`.
- Supabase view: `supabase/migrations/<N+1>_v2_analytics_<seg>.sql` (7 views).
- Each analytics page exports via the shared Export toolbar.

### Per T5 form

- `src/app/(admin)/v2/<seg>/page.tsx` — uses `<T5Form />`, RHF+Zod.
- Zod schema file: `src/app/(admin)/v2/<seg>/schema.ts`.
- Form mutations call existing V1 endpoints unless spec dictates new v2 endpoint.

### Shared export Edge Function

- `supabase/functions/v2-export/index.ts` — single Deno function accepting `{ format: "csv"|"xlsx"|"pdf", data: Row[], metadata: { title, facility, dateRange } }`. Returns streamed file.
- CSV: PapaParse.
- XLSX: SheetJS CE.
- PDF: jsPDF + autotable (same libs used in existing `@react-pdf/renderer` / `jsPDF` slots per `docs/specs/UI-DESIGN-DECISIONS.md`).

### Playwright

- `tests/e2e/ui-v2/analytics-export.spec.ts` — each of 7 analytics pages: load + export each format; file non-empty.
- `tests/e2e/ui-v2/forms.spec.ts` — each of 4 forms: required-field validation, submit happy path, server error handling.

### V1 → V2 evidence

11 screenshot diffs + 11 Loom recordings in PR body.

## Additional requirements

1. All T4 pages use Recharts (already a dep). No D3, no Chart.js.
2. All T5 forms use RHF + Zod per `docs/specs/UI-DESIGN-DECISIONS.md §1`. No uncontrolled form libraries.
3. Form Zod schemas mirror the API request shape exactly. If the V1 endpoint accepts different shape, the form's `onSubmit` transforms — but the schema validates the V2 contract.
4. Exports must complete within 10s for up to 10,000 rows. PDF can page-break.
5. GitHub issues: 11 (one per page), all label `ui-v2`, title prefix `[UI-V2-W<3|4>-<PAGE>]`.

## Gate command

```bash
npm run segment:gates -- --segment "UI-V2-S10" --ui
```

## Acceptance

- 11 pages render under `(admin)/v2/`.
- 7 analytics pages export all three formats successfully.
- 4 forms validate via Zod + submit to backend.
- Shared export Edge Function deployed to staging and callable.
- Playwright analytics + forms suites pass.
- Sentry smoke PASS.
- `smoke.ui-v2-issues` PASS (11 issues, all ticked).
- axe-core zero violations.
- Gate JSON PASS.
- `UI-V2-STATUS.md` S10 box ticked.

## Review hooks

- `agents/playbooks/chief-design-officer-agent.md`.
- `agents/playbooks/performance-agent.md` — export 10k rows stress test.
- `agents/playbooks/security-rls-agent.md` — view + Edge Function access checks.
- `agents/playbooks/qa-agent.md`.

## Commit message

`feat(ui-v2-s10): W3+W4 analytics pages + forms + shared export [UI-V2-S10]`

## Gotchas

- The Care Plan form is genuinely complex (rich text, section templates, approval workflow). Consider breaking it into its own sub-slice if it doesn't fit — document as `UI-V2-S10a` closeout record.
- Finance routes in V1 are called `/admin/finance/ledger`, `/trial-balance`, `/period-close` — not labor / revenue. The "labor analytics" and "revenue" dashboards from the spec page inventory are logical dashboards composed over those tables, not existing routes. Create new V2 routes under `/admin/v2/finance/labor` + `/admin/v2/finance/revenue` and leave V1 ledger/trial-balance alone.
- Export PDF for a 100-row table is fine at synchronous. For 10k rows, stream page-by-page or chunk via multipart response. Test at realistic sizes.

## S10 implementation deviations

S10 is a 6 eng-day plan. Tonight's commit ships a coherent **skeleton** for the 11 pages and the form-submission contract; the live aggregate views, the shared export Edge Function, and the Care Plan rich-text form are all sequenced as named follow-ups so each can land with proper review.

- **7 T4 analytics pages share a single fixture-backed skeleton client.** `W3AnalyticsClient` reads from `haven.vw_v2_facility_rollup` (already deployed in S8.5) for the breakdown table and computes a 4-tile KPI strip from those rows. Charts render placeholder slots — `S10.5` adds per-page time-series views (`vw_v2_<seg>_*`) + Recharts wiring. Skeletons are live so visual fidelity, scope, and table customize/export work today.
- **Care Plan form deferred to S10a.** Rich text + section templates + approval workflow is its own slice per the spec's own gotcha. S10 ships the three simpler forms (resident, admission, incident); Care Plan stays on V1 until S10a.
- **Form submit endpoint is intentionally deferred.** `POST /api/v2/forms/[id]` validates the form id and the caller's auth, then returns a `202 deferred` envelope without writing. The V1 forms at `/admin/<seg>/new` remain the canonical write path. S10a will wire each V2 form to the existing V1 create endpoint (or a new `/api/v2/<seg>` endpoint where the V1 contract is too coupled to V1 UI assumptions).
- **Shared export Edge Function deferred to S10.5.** `supabase/functions/v2-export/index.ts` calls for SheetJS + jsPDF + autotable bundled into Deno — meaningful infrastructure work. Today the analytics skeleton's `Export` toolbar copy points users at the DataTable's CSV export (already shipped in S6) and notes XLSX/PDF land with the Edge Function in S10.5.
- **Per-page Supabase views (7) deferred to S10.5.** Authoring 7 new aggregate views needs locked KPI semantics + product input on which charts each page surfaces. Skeletons today let UAT validate layout + nav before view authoring locks downstream consumers.
- **Playwright spec deferred** (no `@playwright/test` runner in repo, same as prior slices).
- **Loom + screenshot diffs + GitHub `ui-v2` issue mirror deferred** — owner actions tied to the staging branch deploy.
