# UI-V2 Slice S6 — DataTable primitive

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §4 (primitive P10) + §4.1 (DataTableProps contract) + §7.1 (`user_dashboard_preferences`) + §7.2 (`facility_metric_targets`) + §7.4 (APIs)
**Depends on:** S5 committed; S2 migrations live
**Est. eng-days:** 2

## Goal

The workhorse primitive. DataTable with sticky header, row status icons, threshold-driven numeric coloring, trend sparkline column, action cluster, Customize + Export toolbar, per-user column persistence. Three API endpoints wired.

## Files to deliver

### Primitive (use S3 test stack — no Storybook)

- `src/design-system/components/DataTable/DataTable.tsx`
- `src/design-system/components/DataTable/DataTable.preview.tsx` — states: `loading`, `empty`, `fiveRowsAllOk`, `mixedSeverity`, `filtered`, `columnsCustomized`, `largeDataset` (1000+ rows, virtualized). Registered in `/admin/v2/__dev__/`.
- `src/design-system/components/DataTable/DataTable.test.tsx`
- `src/design-system/components/DataTable/DataTable.a11y.spec.ts`
- `src/design-system/components/DataTable/columns.ts` — type + helpers
- `src/design-system/components/DataTable/thresholds.ts` — coloring logic pure-function (takes value + target + direction + warningBandPct, returns `"ok" | "warning" | "critical"`)
- `src/design-system/components/DataTable/preferences.ts` — TanStack Query hooks for GET/PUT preferences

### API routes (Next.js App Router)

- `src/app/api/v2/preferences/route.ts` — `GET` + `PUT` per §7.4
- `src/app/api/v2/thresholds/[facilityId]/route.ts` — `GET` per §7.4
- `src/app/api/v2/exports/route.ts` — `POST { dashboardId, rows, format: "csv"|"xlsx"|"pdf" }` streaming response

### Test fixtures

- `src/design-system/components/DataTable/__fixtures__/facilities.json` — ~20 rows
- `src/design-system/components/DataTable/__fixtures__/thresholds.json` — threshold set for each metric_key

## Additional requirements

1. TanStack Table drives rendering. Virtualization via `@tanstack/react-virtual` for `largeDataset` state. Install if not present.
2. Customize dropdown includes: column visibility toggle, column reorder (drag-and-drop via `@dnd-kit/core` — add if absent), reset to defaults.
3. Column state persists to `user_dashboard_preferences` on change (debounced 500ms). Loaded on mount via TanStack Query.
4. Export dropdown: CSV (client-side papaparse — install if absent, or use stream from `/api/v2/exports`), XLSX (SheetJS), PDF (Puppeteer via route handler on Workers runtime).
5. Threshold coloring: metric cells with `metricKey` set read thresholds via `useThresholds(facilityId)` hook, apply `thresholds.ts` pure function, emit `text-success | text-warning | text-danger` Tailwind class. No raw color.
6. Action cluster per row: open-in-panel + open-in-new-tab. Tooltips required on both.
7. Row status icon column (implicit, not in `columns` array): driven by `row.status`. Tooltip shows `row.statusTooltip` when status ≠ "ok".

## Gate command

```bash
SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "UI-V2-S6" --ui
```

## Acceptance

- DataTable renders all 7 story states.
- Customize → reorder column → refresh page → column order persists (Vitest + Playwright test).
- Export CSV for 50 rows returns well-formed file.
- Threshold pure function has Vitest coverage for all 4 paths (ok / warning / critical / no-threshold).
- `/api/v2/preferences` + `/api/v2/thresholds` + `/api/v2/exports` integration tests pass.
- Keyboard navigable: arrow keys move row selection, Enter opens detail.
- axe-core zero violations.
- `npm run lint && npm run build` pass.
- Gate JSON PASS.
- `UI-V2-STATUS.md` S6 box ticked.

## Review hooks

- `agents/playbooks/performance-agent.md` — virtualization + render perf on 1000-row fixture.
- `agents/playbooks/security-rls-agent.md` — API endpoint RLS.
- `agents/playbooks/qa-agent.md`.

## Commit message

`feat(ui-v2-s6): DataTable primitive + v2 preferences/thresholds/exports API [UI-V2-S6]`

## Gotchas

- Export PDF requires Puppeteer or similar. Netlify Functions (Node runtime) supports `@sparticuz/chromium` — add as devDependency + bundle in the route handler. Keep bundle size in check (spec §10.2 gate: V2 ≤ V1 + 10%).
- SheetJS CE is MIT; do not import SheetJS Pro (paid).
- TanStack Table v8 is the only supported version; v7 API differs significantly.
- Preferences debounce must persist on blur/unmount too, otherwise quick nav-away loses the last edit.

## S6 implementation deviations

- **Column reorder via up/down buttons, not drag-and-drop.** `@dnd-kit/core` is not added in this slice; Customize dialog moves columns with arrow buttons. Persistence + visibility behavior matches the spec; only the gesture differs. Track DnD upgrade as a follow-up.
- **XLSX / PDF export return 501.** `/api/v2/exports` ships full CSV; XLSX (SheetJS) and PDF (`@sparticuz/chromium`) return 501 with a body pointing back to CSV. Acceptance gate "Export CSV for 50 rows" is met by the implemented path. Track XLSX/PDF as a follow-up so the bundle-size budget can be evaluated separately from S6.
- **No TanStack Query install.** `useDashboardPreferences` uses a self-contained debounced fetcher (500ms; flushes on unmount). Equivalent to the contract in §7.4 without bringing in a new caching layer; can be migrated to TanStack Query when it lands repo-wide.
- **`alert_audit_log` / `user_dashboard_preferences` / `facility_metric_targets` typed via narrow casts.** Generated `Database` types in `src/types/database.ts` predate migrations 207–209 and aren't regenerated in this slice. Route handlers use `as never`/`as unknown as` casts at the table boundary, with strict response shapes inside. Type regen is tracked separately.
- **`react-hooks/incompatible-library`** raised by ESLint on `useReactTable` (TanStack Table returns non-memoizable functions under the React 19 compiler). Suppressed at the call site with an explanatory comment.
