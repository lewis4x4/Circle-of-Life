# PATCH_PLAN_PORTALS.md

List-only audit of the five non-admin shells. **No code is migrated here** — that's a separate PR per shell. This plan estimates effort, lists offenders, and locks in the order.

The reference bar is identical to the admin audit (`docs/ui-audit/DESIGN_PRINCIPLES.md`). The portals are the same product as `/admin` and must look like it.

## Status per shell

| Shell | File | LOC | Dated-tell hits | Raw color utilities | Estimate |
|-------|------|----:|----:|----:|---|
| Caregiver | `src/components/layout/CaregiverShell.tsx` | 322 | 6 | 9 (zinc, teal, emerald) | 1 day |
| Family | `src/components/layout/FamilyShell.tsx` | 202 | 5 | 12 (stone, rose) | 1 day |
| Onboarding | `src/components/layout/OnboardingShell.tsx` | 116 | 2 | 8 (slate) | 0.5 day |
| MedTech | `src/components/layout/MedTechShell.tsx` | 96 | 0 | 3 (slate) | 0.25 day |
| Dietary | `src/components/layout/DietaryShell.tsx` | 89 | 0 | 3 (slate) | 0.25 day |

"Dated-tell hits" counts the union of `glass-*`, `backdrop-blur`, `rounded-[…]`, `font-display`, `tracking-widest`, `text-4xl/5xl`, `bg-gradient`, `bg-[#…]`, `caregiver-shell`, `family-shell` per file. "Raw color utilities" counts uses of hard-coded `slate-*`, `zinc-*`, `stone-*`, `rose-*`, `emerald-*`, `teal-*`.

Total estimate: **3 engineering days** across all five shells.

## Order of migration

Smallest blast radius first so each PR can land independently and visual regression catches it.

1. **Dietary** (0.25 day) — **shipped 2026-05-14** ([PR #35](https://github.com/lewis4x4/Circle-of-Life/pull/35), merged `21efc44`). 89 LOC. No moonshot tells, only `text-slate-*` chrome. Replaced with semantic tokens, dropped the gradient backdrop. Single PR.
2. **MedTech** (0.25 day) — **shipped 2026-05-15** ([PR #36](https://github.com/lewis4x4/Circle-of-Life/pull/36), merged `aa76646`). 96 LOC. Same shape as Dietary plus an enforced `<div className="dark">` wrap.
3. **Onboarding** (0.5 day) — **shipped 2026-05-15** ([PR #37](https://github.com/lewis4x4/Circle-of-Life/pull/37), merged `84f0652`). 116 LOC. Marketing-leaning header lifted to admin topbar pattern. New `WizardSteps` primitive (`src/components/ui/wizard-steps.tsx`).
4. **Caregiver** (1 day) — **shipped 2026-05-15** ([PR #38](https://github.com/lewis4x4/Circle-of-Life/pull/38), merged `0e42604`). 322 LOC, mobile-first cockpit. New `BottomNav` + `StatusPill` primitives. Forced-dark via `<div className="dark">` wrap. 9 baselines including a CSS-injected simulated iPhone home-indicator capture.
5. **Family** (1 day) — **shipped 2026-05-15**. 202 LOC, tablet-first. Most moonshot: `glass-card-light` floating dock at `rounded-[2.5rem]`, oversized `rounded-[1.8rem]` nav tiles, warm-cream gradient. All dropped; reuses the `BottomNav` primitive. Forced-light via `<div className="light">` wrap.

## Cross-cutting offenders to fix in each PR

For every portal:
- Drop `glass-card`, `glass-panel`, `glass-card-light`, `glass-*` usages from chrome (preserve only on stationary decorative cards that already look like Linear/Notion).
- Drop `caregiver-shell` and `family-shell` body classes (the radial-gradient background overrides). Replace with `bg-background`.
- Replace `font-display font-light/semibold` with `font-semibold` (the alias resolves to Inter today; the alias name is misleading and the weight is wrong).
- Replace `tracking-widest` micro-cap labels with `text-[11px] uppercase tracking-wider text-muted-foreground`.
- Replace `rounded-[2.5rem]`, `rounded-[1.8rem]`, `rounded-3xl/4xl` on cards with `rounded-lg`/`rounded-xl`.
- Replace raw `slate-*`/`zinc-*`/`stone-*`/`rose-*` color utilities with semantic tokens (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, etc.). Status colors → `text-success`, `text-warning`, `text-info`, `text-destructive`.
- Wrap topbar icon-only buttons in shadcn `Tooltip` using the base-ui `render` prop pattern (NOT `asChild` — see `AdminShell.tsx` for the working pattern after the a11y gate caught the regression).
- Add `aria-label` on every icon-only button and `aria-hidden` on every decorative icon.

## What each portal keeps

- **Caregiver bottom-nav.** It's the correct mobile pattern. Just restyle to `h-14 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80`.
- **Family touch-target sizes.** Family residents/visitors run on touch screens; minimum tap targets stay at 44×44. The dock can be a `Sheet` or fixed bottom bar, both fine.
- **Onboarding step indicator.** Build a new design-system primitive `OnboardingSteps` rather than inline it; reuse across all wizard-style flows.
- **MedTech cockpit modal flow.** No structural change; only chrome.
- **Dietary clinical review list.** No structural change; only chrome.

## Out of this plan

- Per-portal route audit (e.g., the resident-page chrome inside CaregiverShell). Each portal PR fixes the shell + the index page only; route content is a follow-up sweep.
- The `moonshot/` component family (V2Card, Sparkline, AmbientMatrix, PulseDot, KineticGrid) is used by both admin and portals. The admin executive overview no longer imports them; the next portal PRs should follow suit. Once all five shells stop importing `@/components/ui/moonshot/*`, those files can be deleted in a final cleanup commit.
- The kinetic-grid utility, V2Card, and Sparkline are reused in some clinical pages outside the shells (e.g., caregiver resident detail). Those are NOT in this plan — they belong with their owning page in a follow-up.

## Acceptance per shell

A portal PR is done when:
- Shell renders identically in light + dark mode.
- Authenticated a11y for the portal's primary route reports 0 serious/critical violations (run `BASE_URL=… AXE_AUTH_ROUTES=/caregiver node scripts/a11y-authenticated.mjs`).
- Visual regression baselines for the portal exist at 3 viewports × 2 themes (extend `scripts/screenshot-dashboard.mjs` `ROUTES` array; commit baselines under `docs/ui-audit/screenshots/`).
- No `glass-*` utility, no `caregiver-shell`/`family-shell` class, no `rounded-[2rem]+`, no `font-display`, no raw `slate-*`/`zinc-*` in the shell file. Verify with `grep -E '(glass-|caregiver-shell|family-shell|rounded-\[2|font-display|slate-|zinc-)' src/components/layout/<Shell>.tsx` returning empty.

## Owner sign-off

Estimate assumes the audit's design tokens (`globals.css`) are already in place — they are. Estimate assumes shadcn primitives are installed — they are. The work is mechanical chrome substitution, not new design, so a senior engineer pairing with the design lead should clear all five in **a week**.

Open question before starting: do the touch-screen portals (Family, Caregiver) need a separate "touch" density variant of the design tokens? Decide before Caregiver PR.
