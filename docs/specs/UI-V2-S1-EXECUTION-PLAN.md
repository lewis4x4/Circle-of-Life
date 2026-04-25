# UI-V2-S1 Execution Plan

**Goal:** Future UI-V2 primitives can consume approved design tokens via semantic Tailwind classes; V2 routing is feature-flagged; scope is URL-backed; scoped lint rules block raw colors, raw spacing, and computed KPI tiles without tooltip copy.

## Files To Deliver

- `src/design-system/tokens.ts`
- `tailwind.config.ts`
- `src/lib/flags.ts`
- `src/lib/scope.ts`
- `src/proxy.ts` (Next 16 proxy rewrite surface for the S1 middleware contract)
- `eslint-rules/no-raw-color.mjs`
- `eslint-rules/no-raw-spacing.mjs`
- `eslint-rules/require-kpi-info.mjs`
- `eslint.config.mjs`
- `src/design-system/tokens.test.ts`
- `src/lib/flags.test.ts`
- `src/lib/scope.test.ts`
- `package.json` / `package-lock.json` for the `test:ui-v2` script and Vitest runner
- `docs/specs/UI-V2-STATUS.md`
- `test-results/agent-gates/*-UI-V2-S1.json`

## Gate Command

```bash
SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "UI-V2-S1"
```

## Acceptance

- `npm run lint` passes.
- `npm run build` passes.
- `npm run test:ui-v2` passes.
- `tokens.ts` matches `UI-V2-DESIGN-SYSTEM.md` section 3.
- `uiV2()` defaults false unless `NEXT_PUBLIC_UI_V2=true`.
- Scope round-trips `owner`, `group`, repeatable `facility`, `start`, and `end` URL params.
- Proxy rewrite helper is tested for route exists + flag on, route missing + flag on, and flag off.
- Gate JSON has `verdict: "PASS"` and all required checks pass.

## Commit Message

`feat(ui-v2-s1): design tokens + flags + scope + lint rules [UI-V2-S1]`

## Mission Alignment

`pass` — S1 creates the role-governed, audit-friendly visual foundation without changing production routes or data access.
