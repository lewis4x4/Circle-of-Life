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
