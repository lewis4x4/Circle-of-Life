# Caregiver baselines — Phase C step 4

## Capture role

`/caregiver` is gated by the Edge middleware (`src/lib/auth/caregiver-shell.ts`) to `caregiver` and `housekeeper` roles. The owner / org_admin redirect to `/admin`, so the dietary-style owner harness does NOT work here.

Baselines were captured as:

- Email: `maria.garcia@circleoflifealf.com`
- `app_role`: `caregiver`
- Supabase user id: `a0000000-0000-0000-0000-000000000004`

`james.thompson@circleoflifealf.com` is also seeded as `caregiver` but had a password drift that the reset path didn't clear during this PR. Use `maria.garcia` until the demo seed is refreshed.

Reproduce with:

```bash
SCREENSHOT_USER_EMAIL=maria.garcia@circleoflifealf.com \
ROUTES_JSON='[{"id":"caregiver","path":"/caregiver"}]' \
VIEWPORTS_JSON='[{"name":"1440x900","width":1440,"height":900},{"name":"1920x1080","width":1920,"height":1080},{"name":"2560x1440","width":2560,"height":1440},{"name":"393x852","width":393,"height":852}]' \
SCREENSHOT_OUT_DIR=docs/ui-audit/screenshots-phase-c-portals/caregiver \
SETTLE_MS=4000 \
node scripts/screenshot-dashboard.mjs

# Plus the 9th capture for the simulated iPhone home-indicator inset:
node scripts/screenshot-caregiver-iphone-safe-area.mjs
```

## What the images show

Caregiver is the only Haven shell where **mobile is the canonical surface, not the fallback**. The 4 viewports cover both modes:

- 1440×900 — tablet landscape / small laptop. Side-rail visible at left edge.
- 1920×1080 — desktop. Same chrome scaled up.
- 2560×1440 — large desktop. Same chrome scaled up.
- 393×852 — iPhone 14 Pro portrait. Side-rail hidden, bottom-nav active.

Each capture renders:

- **Header**: `bg-background/95` with `backdrop-blur`, `border-border` divider, facility name (`text-foreground`), shift label (`text-[11px] uppercase tracking-wider text-muted-foreground`). Replaces the old `bg-black/20` marketing-tone bar with `font-display` typography.
- **StatusPill** (new primitive at `src/components/ui/status-pill.tsx`): renders sync state via the `variant` prop, dot via `dot`, animated pulse via `pulsing`. Visible in the screenshots showing `OFFLINE` (destructive variant) because the dev server is local and the rounding-sync hook reports offline.
- **Alerts button**: `rounded-full bg-card border-border` with `hover:bg-accent active:bg-accent` (paired hover/active per §13).
- **BottomNav** (new primitive at `src/components/ui/bottom-nav.tsx`): visible only on `< md` viewports. Five tab items (Home / Meds / Rounds / Report / Me) at `min-h-11` touch targets, active item gets `data-[state=active]:bg-accent data-[state=active]:text-accent-foreground`.

## Safe-area inset (the 9th capture)

`caregiver-393x852-dark-safe-area.png` is the special capture that visually demonstrates the `env(safe-area-inset-bottom)` accommodation. Background:

- The BottomNav primitive ships `h-[calc(3.5rem+env(safe-area-inset-bottom))]` and `pb-[env(safe-area-inset-bottom)]`.
- In headless Playwright, `env(safe-area-inset-bottom)` resolves to `0px` because there's no physical device chrome to consume. The standard `caregiver-393x852-dark.png` therefore shows the bottom-nav at `h-14` (56px) with no extra padding — accurate to what the chrome does, but invisible as a "the nav clears the home indicator" demonstration.
- The safe-area capture (`scripts/screenshot-caregiver-iphone-safe-area.mjs`) injects CSS that overrides the BottomNav selector to `padding-bottom: 34px` and renders a synthetic home-indicator strip at the bottom. The result is what a real iPhone 14 Pro would render: tab items pushed clear of the indicator, no overlap, visual confirmation that the chrome accommodates the inset.

When the next portal sweep checks for regressions, this capture is the visual gate: the bottom-nav must continue to render its tab items above the strip, never under it.

## Forced-dark

Caregiver is dark-only by design. Shifts include night rotations (11P-7A) and bedside use in dim resident rooms; a light flash mid-shift is both glare-painful and a clinical-misread risk. The `<div className="dark">` wrapper on `CaregiverShell.tsx` enforces dark tokens regardless of `next-themes` state — light-theme captures intentionally render dark. Belt + suspenders: `setTheme("dark")` still fires for cross-component side effects.

Compare any `*-light.png` to its `*-dark.png` sibling: they should be near-identical. If they diverge, the dark guard regressed.

## Files

| Viewport | Theme | File | Notes |
|----------|-------|------|-------|
| 1440×900 | light | `caregiver-1440x900-light.png` | Tablet — side-rail visible |
| 1440×900 | dark | `caregiver-1440x900-dark.png` | Tablet — side-rail visible |
| 1920×1080 | light | `caregiver-1920x1080-light.png` | Desktop |
| 1920×1080 | dark | `caregiver-1920x1080-dark.png` | Desktop |
| 2560×1440 | light | `caregiver-2560x1440-light.png` | Large desktop |
| 2560×1440 | dark | `caregiver-2560x1440-dark.png` | Large desktop |
| 393×852 | light | `caregiver-393x852-light.png` | iPhone 14 Pro — bottom-nav |
| 393×852 | dark | `caregiver-393x852-dark.png` | iPhone 14 Pro — bottom-nav |
| 393×852 | dark + safe-area | `caregiver-393x852-dark-safe-area.png` | iPhone 14 Pro with simulated 34px home-indicator |
