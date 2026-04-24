# UI-V2 Slice S3 — Primitives A (shell + chrome)

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §4 (primitives P01, P02, P03, P04, P13)
**Depends on:** S2 committed (`user_dashboard_preferences` must exist for FilterBar save-view persistence)
**Est. eng-days:** 2

## Goal

Five shell + chrome primitives render per spec, each with Storybook stories, Vitest tests, and axe accessibility tests. No page yet consumes them; they're pure component library work.

## Files to deliver

For each primitive: component + story + test + a11y spec in `src/design-system/components/<Name>/`.

### P01 — `<PageShell>`

- `src/design-system/components/PageShell/PageShell.tsx`
- `src/design-system/components/PageShell/PageShell.stories.tsx` — states: `default`, `withRightRail`, `noFilters`
- `src/design-system/components/PageShell/PageShell.test.tsx`
- `src/design-system/components/PageShell/PageShell.a11y.spec.ts`
- `src/design-system/components/PageShell/index.ts` — barrel export

### P02 — `<TopBar>`

- `src/design-system/components/TopBar/...`
- Mounts inside existing `AdminShell` header region. Do NOT replace `AdminShell`; extend.
- States: `default`, `withCopilot`, `withNotifications`

### P03 — `<ScopeSelector>`

- `src/design-system/components/ScopeSelector/...`
- Three-tier: Owner → Group → Facility. URL-backed via `useScope()` (from S1).
- States: `empty`, `ownerOnly`, `ownerGroupFacility`, `multiFacility`

### P04 — `<FilterBar>`

- `src/design-system/components/FilterBar/...`
- Date range, facilities, regions, statuses. "Reset" and "Save View" buttons.
- Save View persists to `user_dashboard_preferences.saved_views` (via `/api/v2/preferences`, stubbed in S3, fully wired in S6).
- States: `default`, `withSavedView`, `filtersActive`

### P13 — `<AuditFooter>`

- `src/design-system/components/AuditFooter/...`
- Footer renders: `Audit Trail` link (scope-aware) + green Live dot + "Updated N ago" + facility-local timezone label.
- States: `default`, `offline` (no Live dot)

## Additional requirements

1. Every primitive reads colors/spacing via Tailwind semantic classes from `tokens.ts` (S1). Zero raw hex/px. Lint enforced.
2. Each component is keyboard-operable end-to-end. Focus ring visible. Tab order matches visual order.
3. Each `.a11y.spec.ts` runs `@axe-core/playwright` against the rendered Storybook story. Zero violations.
4. No primitive imports another slice's primitives. S3 stands alone.

## Gate command

```bash
SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "UI-V2-S3" --ui
```

`--ui` is required — this slice introduces visual components.

## Acceptance

- Five primitives exist with the 4-file pattern each (component + story + test + a11y).
- `npm run lint` passes (new `no-raw-color` + `no-raw-spacing` rules from S1 lint clean).
- `npm run build` passes.
- Storybook builds (`npx storybook build` if configured) with no errors.
- Each a11y spec exits 0 with zero axe violations.
- Gate JSON PASS at `test-results/agent-gates/*-UI-V2-S3.json`.
- `UI-V2-STATUS.md` S3 box ticked with gate filename.

## Review hooks

- `agents/playbooks/chief-design-officer-agent.md` — visual + interaction review.
- `agents/playbooks/qa-agent.md` — test coverage + a11y.

## Commit message

`feat(ui-v2-s3): primitives A — shell + chrome [UI-V2-S3]`

## Gotchas

- `<TopBar>` must not break existing `AdminShell` for non-V2 routes. Integration is additive.
- `<ScopeSelector>` initial data (owner/group/facility options) loads from `/api/admin/facilities` (existing). Do not introduce new endpoints for list data here.
- `<FilterBar>` save-view API call is stubbed in S3 (returns success without persistence). S6 wires the real persistence. Mark stubbed code with `// TODO(ui-v2-s6): wire /api/v2/preferences`.
