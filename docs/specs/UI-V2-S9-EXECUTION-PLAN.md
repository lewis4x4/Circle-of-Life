# UI-V2 Slice S9 — W2 P0 List + Detail pairs

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §5 (T2, T3) + §6 (routes 13, 14, 27, 28, incidents list+detail, alerts list+detail) + §9 W2 gate
**Depends on:** S8 committed
**Est. eng-days:** 5

## Goal

Four list+detail pairs migrated. Scope preserved across list→detail nav. Row selection opens side-panel detail (T3 variant within T2) without full page navigation for lightweight records.

## Routes migrated

| List | Detail |
|---|---|
| `/admin/residents` | `/admin/residents/[id]` |
| `/admin/executive/alerts` | `/admin/executive/alerts/[id]` (new — may not exist in V1) |
| `/admin/incidents` | `/admin/incidents/[id]` |
| `/admin/admissions` | `/admin/admissions/[id]` |

## Files to deliver

### Per pair (×4)

- `src/app/(admin)/v2/<seg>/page.tsx` — T2 List page.
- `src/app/(admin)/v2/<seg>/[id]/page.tsx` — T3 Entity Detail page.
- `src/app/(admin)/v2/<seg>/loading.tsx`, `error.tsx`.
- `src/app/(admin)/v2/<seg>/[id]/loading.tsx`, `error.tsx`.

### API

- `src/app/api/v2/lists/[listId]/route.ts` — unified list endpoint with scope filtering. `listId ∈ { "residents", "alerts", "incidents", "admissions" }`.
- Detail routes use existing `/api/admin/<seg>/[id]` endpoints; if shape differs from T3 expectations, add adapter layer in `src/app/(admin)/v2/<seg>/[id]/page.tsx` (server-side transform).

### Supabase views

- `supabase/migrations/215_v2_list_residents.sql`
- `supabase/migrations/216_v2_list_alerts.sql`
- `supabase/migrations/217_v2_list_incidents.sql`
- `supabase/migrations/218_v2_list_admissions.sql`

### Playwright

- `tests/e2e/ui-v2/list-detail.spec.ts`:
  - Scope preservation: set facility filter on list → click row → detail URL contains `?facility=<id>`.
  - Row action cluster: open-in-panel opens `Sheet` side panel with `<T3EntityDetail />`; open-in-new-tab opens in new tab.
  - Row status tooltip: hover on warning/critical row → tooltip visible with statusTooltip text.
  - Keyboard: arrow keys navigate rows; Enter opens detail.

### V1 → V2 comparison evidence

Per pair: screenshot diffs V1/V2, Loom in PR body.

## Additional requirements

1. Scope preservation is the single hardest criterion of this slice. Every link from list to detail uses `<Link>` from `src/lib/scope.ts` that auto-appends scope params. Every server-side data fetch reads scope from URL, not from Zustand.
2. T3 Entity Detail tabs are: `Overview`, `Clinical`, `Staffing`, `Finance`, `Compliance`, `Activity`. Tabs applicable to each entity type vary — declare per-entity tab sets in `src/app/(admin)/v2/<seg>/[id]/tabs.ts`.
3. Activity timeline tab on every T3 reads from the module's existing audit log table. If no audit log exists for that entity yet, stub the tab with "No activity recorded" empty state.
4. Side-panel drawer (inline detail) loads the detail payload on row select, NOT on row click-through. Click-through is "open in new tab" behavior.

## Gate command

```bash
npm run segment:gates -- --segment "UI-V2-S9" --ui
```

Sentry token must still be valid from S8.

## Acceptance

- Four list+detail pairs render, each using T2 (list) and T3 (detail).
- Scope preservation verified by Playwright.
- Side-panel drawer + new-tab open both work.
- Row status tooltips present for every non-"ok" row.
- Four Supabase views created with RLS.
- Sentry smoke PASS.
- `smoke.ui-v2-issues` PASS (GH issues created + all acceptance boxes ticked).
- axe-core zero violations.
- Gate JSON PASS.
- `UI-V2-STATUS.md` S9 box ticked.

## Review hooks

- `agents/playbooks/chief-design-officer-agent.md`.
- `agents/playbooks/qa-agent.md`.
- `agents/playbooks/security-rls-agent.md`.

## Commit message

`feat(ui-v2-s9): W2 P0 list+detail pairs (residents/alerts/incidents/admissions) [UI-V2-S9]`

## Gotchas

- `/admin/executive/alerts/[id]` may not exist as a V1 route. Create the V2 route fresh; optionally add a V1 redirect if marketing/support already links to something.
- Resident detail is the heaviest migration — residents have 7 existing sub-routes (`/residents/[id]/assessments`, `/care-plan`, `/medications`, `/vitals`, etc.). S9 scope is the detail root only; sub-routes stay on V1 until S10/S11.
- Side-panel drawer state (which row is open) should persist via URL hash, not Zustand, so deep-linking to a row+panel state works.
