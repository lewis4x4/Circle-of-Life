# UI-V2 Slice S8 — W1 P0 Dashboards

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §5 (T1) + §6 (routes 1, 2, 19, 17, 25) + §9 W1 gate
**Depends on:** S7 committed (templates exist; W0 closed)
**Est. eng-days:** 4

## Goal

Four P0 dashboard pages rendered under `(admin)/v2/` using T1 template. Feature flag `NEXT_PUBLIC_UI_V2=true` in staging; middleware routes `/admin/<seg>` → `/admin/v2/<seg>` for each migrated page. V1 versions untouched.

## Routes migrated

| V1 route | V2 page | Dashboard ID |
|---|---|---|
| `/admin` | `src/app/(admin)/v2/page.tsx` | `command-center` |
| `/admin/executive` | `src/app/(admin)/v2/executive/page.tsx` | `executive-intelligence` |
| `/admin/quality` | `src/app/(admin)/v2/quality/page.tsx` | `clinical-quality` |
| `/admin/rounding` | `src/app/(admin)/v2/rounding/page.tsx` | `rounding-operations` |

## Files to deliver

### Per page (×4)

- `src/app/(admin)/v2/<seg>/page.tsx` — server component loads dashboard payload, passes to `<T1Dashboard />`.
- `src/app/(admin)/v2/<seg>/loading.tsx` — skeleton.
- `src/app/(admin)/v2/<seg>/error.tsx` — error boundary per existing pattern (`src/app/(admin)/error.tsx`).

### Dashboard API

- `src/app/api/v2/dashboards/[id]/route.ts` — single handler returning `{ kpis, panels, alerts, actions, table }` per dashboard ID. Scope-aware (reads `owner`, `group`, `facility[]`, `start`, `end` from URL).

### Supabase views (recommended)

Per spec §9 W1 gate: "one Supabase view per dashboard returning the full T1 payload in a single call."

- `supabase/migrations/211_v2_dashboard_command_center.sql` — `create or replace view haven.vw_v2_command_center_kpis as ...`
- `supabase/migrations/212_v2_dashboard_executive.sql`
- `supabase/migrations/213_v2_dashboard_quality.sql`
- `supabase/migrations/214_v2_dashboard_rounding.sql`

Each view is RLS-aware (reads `haven.accessible_facility_ids()`).

### Playwright smoke

- `tests/e2e/ui-v2/dashboards.spec.ts` — for each of the 4 routes:
  - Load with flag on → V2 renders.
  - Load with flag off → V1 renders (fall-through).
  - Change scope (pick different facility) → URL updates + data reloads.
  - Click a row action → opens side panel (to be wired in S9 where the detail exists).

### V1 → V2 comparison evidence

- `playwright/snapshots/v1/<seg>.png` + `playwright/snapshots/v2/<seg>.png` for each page.
- PR uses `.github/PULL_REQUEST_TEMPLATE/ui-v2.md`. Drag-drop Loom or attach short video per page.

## Additional requirements

1. Flag on in staging only. Netlify staging env: `NEXT_PUBLIC_UI_V2=true`. Production stays `false`.
2. GitHub issues mirror: create one labeled `ui-v2` titled `[UI-V2-W1-<DASHBOARD>] Migrate /admin/<seg> → T1` per page. Acceptance checklist inside body per PR template. `scripts/agent-gates/ui-v2-issue-acceptance.mjs` must pass.
3. Sentry smoke gate MUST be PASS (not SKIP) for this slice. S8 is the first slice that actually serves pages at runtime.

## Gate command

```bash
# Verify Sentry env set and token valid
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" https://sentry.io/api/0/organizations/blackrockai/ | jq -r .slug
# Must print: blackrockai

npm run segment:gates -- --segment "UI-V2-S8" --ui
```

## Acceptance

- Four pages render under `(admin)/v2/` using `<T1Dashboard />`.
- Middleware rewrite works: flag on → V2; flag off → V1; V2 not implemented → fall-through.
- Four Supabase views created with RLS.
- Playwright smoke passes all 4 routes.
- axe-core zero violations on each route.
- Four GitHub issues created with label `ui-v2` and acceptance boxes ticked.
- PR body contains V1→V2 recording + screenshot diffs per template.
- `smoke.sentry` gate check **passed** (not skipped).
- Gate JSON PASS.
- `UI-V2-STATUS.md` S8 box ticked.

## Review hooks

- `agents/playbooks/chief-design-officer-agent.md` — visual fidelity against reference screen (Variant B).
- `agents/playbooks/performance-agent.md` — LCP + TTI on V2 vs V1.
- `agents/playbooks/security-rls-agent.md` — new view RLS.
- `agents/playbooks/qa-agent.md`.

## Commit message

`feat(ui-v2-s8): W1 P0 dashboards migrated to T1 [UI-V2-S8]`

## Gotchas

- Do not delete V1 pages. Only add V2. Flag drives which renders. V1 deletion is S12.
- `/admin/rounding` is a deep hub with sub-routes. S8 scope is the hub index only. Sub-routes (`/rounding/live`, `/rounding/watches`, etc.) are S9/S11.
- Dashboard payload shape is owned by the `vw_v2_*` views. Changing the shape post-S8 means migration + view rewrite. Lock the shape in S8.
- Each dashboard has different KPI tiles (spec §6 inventory) — do not copy-paste one view across all four. Each view is bespoke per dashboard ID.
