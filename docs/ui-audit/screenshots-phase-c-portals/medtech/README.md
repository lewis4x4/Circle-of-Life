# MedTech baselines — Phase C step 2

## Capture role

`/med-tech` is RBAC-locked to `med_tech` and `nurse` only. **Owner is not authorized** — see `isMedTechRole` in `src/lib/auth/app-role.ts`. The owner JWT redirects out of the shell before the cockpit renders, so the dietary-style `milton.smith` capture path does not work here.

Baselines were captured as:

- Email: `medtech@circleoflifealf.com`
- Display name: Maria Ochoa
- `app_role`: `med_tech`
- Supabase user id: `a0000000-0000-0000-0000-000000000012`

Reproduce with:

```bash
SCREENSHOT_USER_EMAIL=medtech@circleoflifealf.com \
ROUTES_JSON='[{"id":"medtech","path":"/med-tech"}]' \
SCREENSHOT_OUT_DIR=docs/ui-audit/screenshots-phase-c-portals/medtech \
SETTLE_MS=4000 \
node scripts/screenshot-dashboard.mjs
```

## What the images show

Each PNG renders the **shell chrome** — the loading-skeleton pill (`Loading Med-Tech cockpit…`) over the forced-dark background. The cockpit's data hook (`useShiftCurrent`) does not return inside the screenshot window because Maria Ochoa has no active shift in the demo seed, so the actual `Cockpit` component never paints its `ShiftBar` / `NowLane` / `ResidentRail` content. This matches the dietary baseline pattern that already shipped under [PR #35](https://github.com/lewis4x4/Circle-of-Life/pull/35).

The captures' purpose is to baseline **the shell chrome**, not cockpit content. The Cockpit component is out of scope for this PR — see `docs/ui-audit/PATCH_PLAN_PORTALS.md` "Out of this plan" (route content is a follow-up sweep).

## Forced-dark verification

The light-theme captures (`*-light.png`) intentionally still render dark. That is the test: the `<div className="dark">` wrapper on `MedTechShell.tsx` forces dark-variant semantic tokens regardless of `next-themes` state, `prefers-color-scheme`, or a future light-mode toggle. The line-cook station at 05:00 cannot tolerate a light flash mid-pass.

Compare `medtech-1440x900-light.png` to `medtech-1440x900-dark.png`: pixels should be near-identical. If they ever diverge, the dark guard regressed.

## Files

| Viewport | Theme | File |
|----------|-------|------|
| 1440×900 | light | `medtech-1440x900-light.png` |
| 1440×900 | dark | `medtech-1440x900-dark.png` |
| 1920×1080 | light | `medtech-1920x1080-light.png` |
| 1920×1080 | dark | `medtech-1920x1080-dark.png` |
| 2560×1440 | light | `medtech-2560x1440-light.png` |
| 2560×1440 | dark | `medtech-2560x1440-dark.png` |
