# UI-V2 Slice S3 — Primitives A (shell + chrome)

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §4 (primitives P01, P02, P03, P04, P13)
**Depends on:** S2 committed (`user_dashboard_preferences` must exist for FilterBar save-view persistence — stubbed in this slice, fully wired in S6)
**Est. eng-days:** 2

## Goal

Five shell + chrome primitives render per spec, each with a render test (Vitest + Testing Library) and a keyboard + a11y test (Playwright + axe). No Storybook — this repo doesn't have it and standing it up is out of scope. No page yet consumes the primitives; this is pure component library work.

## Pre-flight: set up the V2 component test stack (one-time)

Repo currently has `vitest@4`, `playwright@1.59`, `@axe-core/playwright@4.11`. Missing: DOM env + component testing. Install only what's needed; don't add Storybook.

```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event happy-dom
```

Create `vitest.config.ts` at repo root:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

If `@vitejs/plugin-react` isn't installed yet:
```bash
npm install --save-dev @vitejs/plugin-react
```

Create `src/test-setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

Update `package.json` scripts:
```
"test": "vitest run",
"test:watch": "vitest",
"test:ui-v2": "vitest run src/design-system src/lib"
```
(Replace the existing `test:ui-v2` line which currently hard-codes three files.)

Verify setup:
```bash
npm run test
# S1's three existing tests still pass; no new tests yet
```

## Files to deliver

For each primitive: component + render test + preview file + Playwright a11y spec, all under `src/design-system/components/<Name>/`. No Storybook.

**File pattern per primitive:**
- `<Name>.tsx` — the component
- `<Name>.test.tsx` — Vitest + Testing Library render test (assert regions render; assert keyboard + prop contract)
- `<Name>.preview.tsx` — small server component rendering each state as a section, mounted at `/admin/v2/__dev__/<name>` via the dev route below (documentation, not CI)
- `<Name>.a11y.spec.ts` — Playwright test loading the dev route, scrolling through states, running `@axe-core/playwright` — zero violations
- `index.ts` — barrel export

**Dev preview route (one time, S3):**
- `src/app/(admin)/v2/__dev__/page.tsx` — lists every primitive
- `src/app/(admin)/v2/__dev__/[component]/page.tsx` — server component that `import`s `<component>.preview.tsx` and renders it
- Route is gated by `NEXT_PUBLIC_UI_V2=true` AND `NODE_ENV !== "production"`. Never served to end users.

### P01 — `<PageShell>`

- Composes: `AdminShell` header slot + left nav slot + main + optional right rail + `<AuditFooter>`.
- Props: `{ title, subtitle?, scope?, filters?, actions?, children, rightRail? }` per `UI-V2-DESIGN-SYSTEM §5.1`.
- States in preview: `default`, `withRightRail`, `noFilters`.

### P02 — `<TopBar>`

- Mounts inside existing `AdminShell` header region. Do NOT replace `AdminShell`; extend.
- Renders: page title/subtitle slot + scope selector slot + actions + Copilot button stub + notifications + user menu.
- States: `default`, `withCopilot` (Copilot button visible), `withNotifications` (bell has unread count).

### P03 — `<ScopeSelector>`

- Three-tier: Owner → Group → Facility. URL-backed via `useScope()` (from S1).
- Uses `shadcn/ui` `Select` + `Combobox` where applicable.
- States: `empty`, `ownerOnly`, `ownerGroupFacility`, `multiFacility`.

### P04 — `<FilterBar>`

- Date range, facilities, regions, statuses. "Reset" and "Save View" buttons.
- Save View persists to `user_dashboard_preferences.saved_views`. **S3 stubs the save call** (logs to console, returns success) — `/api/v2/preferences` and real persistence land in S6.
- Mark the stubbed save with `// TODO(ui-v2-s6): wire /api/v2/preferences`.
- States: `default`, `withSavedView`, `filtersActive`.

### P13 — `<AuditFooter>`

- Footer renders: `Audit Trail` link (scope-aware) + green Live dot + "Updated N ago" + facility-local timezone label.
- Timezone label uses `date-fns-tz` (already a dep) with `America/New_York` default.
- States: `default`, `offline` (Live dot grayed).

## Additional requirements

1. Every primitive reads colors/spacing via Tailwind semantic classes from `tokens.ts` (S1). Zero raw hex/px. Lint enforced.
2. Each component is keyboard-operable end-to-end. Focus ring visible. Tab order matches visual order.
3. Each `.a11y.spec.ts` runs `@axe-core/playwright` against the `/admin/v2/__dev__/<name>` preview route with the dev server up. Zero violations.
4. No primitive imports another slice's primitives. S3 stands alone.
5. Components are server/client-safe where possible. `<ScopeSelector>` and `<FilterBar>` are client components (URL writes, interactions). `<PageShell>`, `<TopBar>`, `<AuditFooter>` should be server components by default, escalate to client only if needed.

## Gate command

```bash
SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "UI-V2-S3" --ui
```

`--ui` is required — this slice introduces visual components.

## Acceptance

- Five primitives exist: component + test + preview + a11y spec per primitive (no story file).
- Dev preview route `/admin/v2/__dev__/...` renders each primitive and is gated to non-production.
- `npm run test` passes (includes all S1 tests + new component render tests).
- `npm run lint` passes. S1's `no-raw-color` + `no-raw-spacing` rules lint clean against new primitives.
- `npm run build` passes.
- Each a11y spec exits 0 with zero axe violations when run against local dev server.
- `vitest.config.ts` + `src/test-setup.ts` committed as part of this slice (one-time test infra).
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
