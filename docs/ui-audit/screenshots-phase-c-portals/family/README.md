# Family baselines — Phase C step 5

## Capture role

`/family` is RBAC-locked to the `family` role only (`src/lib/auth/family-shell.ts`). Owner, org_admin, caregiver, med_tech, dietary, and onboarding roles all redirect to their respective shells.

Baselines were captured as:

- Email: `linda.chen@circleoflifealf.com`
- `app_role`: `family`
- Supabase user id: `a0000000-0000-0000-0000-000000000007`

Reproduce with:

```bash
SCREENSHOT_USER_EMAIL=linda.chen@circleoflifealf.com \
ROUTES_JSON='[{"id":"family","path":"/family"}]' \
VIEWPORTS_JSON='[{"name":"1024x1366","width":1024,"height":1366},{"name":"1366x1024","width":1366,"height":1024},{"name":"820x1180","width":820,"height":1180}]' \
SCREENSHOT_OUT_DIR=docs/ui-audit/screenshots-phase-c-portals/family \
SETTLE_MS=4000 \
node scripts/screenshot-dashboard.mjs
```

## Tablet is the canonical surface

Family is the only Haven shell where the **tablet** is the design target, not a phone or a desktop. Older family members read the portal on iPads in living-room or resident-room settings at ~18–24 inches reading distance. The viewport set reflects that:

- **1024×1366** — iPad Pro 12.9" portrait
- **1366×1024** — iPad Pro 12.9" landscape
- **820×1180** — iPad Air portrait

Phone (393×852) and desktop (1440+) viewports are intentionally NOT in this set — the shell is not designed for them. If a family user lands on a phone, the layout collapses to the existing mobile-respectful patterns inherited from the BottomNav primitive; if they land on a desktop, they'll see the same layout centered in a wider viewport (no additional density).

## Forced-light verification

Each viewport has two captures, **light** and **dark**, in the filename. Both should render **visually identical** — that is the test that the forced-light wrap is working.

Background: the screenshot harness sets `.dark` on `<html>` when the requested theme is `dark`, then captures. Without an explicit override, the shell would inherit dark tokens via CSS variables. The `FamilyShell.tsx` wraps content in `<div className="light">`, and `src/app/globals.css` carries a matching `.light` block that re-declares the light tokens — together they pin the shell to the light variant regardless of `next-themes`, system preference, or the harness's forced `.dark` class.

If a future change breaks the forced-light enforcement, the `*-dark.png` captures will diverge from their `*-light.png` siblings. That divergence is the regression signal.

## What the images show

- **Top-right utility cluster**: `Bell` (notifications) + `UserCircle2` (account menu). Both are `h-11 w-11` (44px iOS HIG minimum) with `rounded-full bg-card border-border`. `active:bg-accent` — no hover state (tablet has no hover input).
- **`BottomNav`** primitive (the same one Caregiver uses): 5 tab items (Today / Calendar / Care / Messages / Billing) at `min-h-11`, active item with `data-[state=active]:bg-accent`. The "Today" tab is active in every capture because the route is `/family`.
- **Loading skeleton**: `Opening journal…` is the page's own data-hydration state from the family dashboard page. The shell chrome is what's being audited; the page content is downstream and explicitly out of scope per `PATCH_PLAN_PORTALS.md` "Out of this plan".

## What's not here

- **No floating iPadOS-style dock**. The old shell had a `glass-card-light rounded-[2.5rem]` dock floating ~24px from the bottom edge. This PR collapsed it onto the shared `BottomNav` primitive (full-width, flat semantic chrome) — same pattern Caregiver uses. The visual change is intentional: the floating dock was the most "moonshot" pattern in the codebase and was incompatible with the design principles. If the floating-dock aesthetic ever returns, it does so via new `BottomNav` variants, not a fork.
- **No warm-cream gradient body**. The `family-shell` class with its `radial-gradient` background is gone. `bg-background` (plain white) replaces it. If a single decorative accent is added for warmth later, it goes on a `position: fixed; opacity: 0.03; aria-hidden` overlay element — not on the shell.
- **No `glass-*` utilities**. The old DropdownMenuContent used `glass-card-light rounded-2xl border-white/70 shadow-lg`; the new content uses the primitive defaults (semantic `bg-popover border-border`).

## Files

| Viewport | Theme | File | Notes |
|----------|-------|------|-------|
| 1024×1366 | light | `family-1024x1366-light.png` | iPad Pro portrait |
| 1024×1366 | dark | `family-1024x1366-dark.png` | iPad Pro portrait — verifies forced-light holds |
| 1366×1024 | light | `family-1366x1024-light.png` | iPad Pro landscape |
| 1366×1024 | dark | `family-1366x1024-dark.png` | iPad Pro landscape — verifies forced-light holds |
| 820×1180 | light | `family-820x1180-light.png` | iPad Air portrait |
| 820×1180 | dark | `family-820x1180-dark.png` | iPad Air portrait — verifies forced-light holds |
