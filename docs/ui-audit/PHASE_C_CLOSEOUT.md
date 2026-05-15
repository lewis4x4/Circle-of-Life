# PHASE_C_CLOSEOUT.md

Closeout record for Phase C of the UI audit. Phase C migrated all five non-admin portal shells from the moonshot/marketing-leaning chrome they had inherited (the same chrome that produced the original 171-DRIFT undercount) to the admin chrome bar that landed in Phase A. Every portal now uses semantic-token backgrounds, the same `border-border` / `bg-card` / `text-foreground` vocabulary, and shared primitives where the same pattern recurs.

**Status: CLOSED.** Phase D begins after explicit owner go-ahead — no auto-progression.

## Per-portal status

| # | Portal | LOC | PR | Merge | Forced theme | Notes |
|---|--------|----:|----|-------|-------|-------|
| 1 | Dietary | 89 | [#35](https://github.com/lewis4x4/Circle-of-Life/pull/35) | `21efc44` (2026-05-14) | dark (cockpit) | semantic-token sweep, dropped dead `dietary-shell` class |
| 2 | MedTech | 96 | [#36](https://github.com/lewis4x4/Circle-of-Life/pull/36) | `aa76646` (2026-05-15) | dark (cockpit) | enforced `<div className="dark">` wrap; clinical-glare rationale documented inline |
| 3 | Onboarding | 116 | [#37](https://github.com/lewis4x4/Circle-of-Life/pull/37) | `84f0652` (2026-05-15) | system | marketing header → admin topbar; introduced `WizardSteps` primitive |
| 4 | Caregiver | 322 | [#38](https://github.com/lewis4x4/Circle-of-Life/pull/38) | `0e42604` (2026-05-15) | dark (cockpit) | mobile-first; new `BottomNav` + `StatusPill`; 9 baselines including iPhone safe-area capture |
| 5 | Family | 202 | _(this PR)_ | _(this PR)_ | light (tablet) | most moonshot; floating-dock collapsed onto shared `BottomNav` |

## Primitives introduced

Each lifted only when ≥3 instances of the same pattern already existed in the portal shell or its direct children. Speculative primitives were explicitly avoided.

| Primitive | File | First used by | Standard for |
|-----------|------|---------------|--------------|
| `WizardSteps` / `WizardStep` | `src/components/ui/wizard-steps.tsx` | Onboarding | every multi-step flow (admissions wizard, settings migration, intake) |
| `BottomNav` / `BottomNavItem` | `src/components/ui/bottom-nav.tsx` | Caregiver | every fixed-bottom tab bar on mobile + tablet portals (reused by Family) |
| `StatusPill` | `src/components/ui/status-pill.tsx` | Caregiver | every transient operational-state indicator (sync, shift, break) |

`BottomNav` was reused by Family rather than forked into a "FloatingDock" primitive. The moonshot floating-dock pattern (`rounded-[2.5rem] glass-card-light`) was retired entirely.

## CI guardrails added

Each rule is scoped narrowly so the PR that introduced it shipped clean while still catching future regressions.

| Rule | Scope | Added in |
|------|-------|----------|
| `SYS:` eyebrow pills | repo-wide `*.tsx` | Phase A |
| `text-5xl+` on PageClient | `*PageClient.tsx` | Phase A |
| `rounded-3xl` / `rounded-[2.5rem]` on PageClient | `*PageClient.tsx` | Phase A |
| Uppercase CTAs | repo-wide `*.tsx` | Phase A |
| Gradient text on chrome | `*PageClient.tsx` | Phase A |
| Hand-rolled `WizardSteps` indicators | repo-wide, excluding the primitive | Phase C step 3 (Onboarding) |
| Hand-rolled `<BottomNav>` (fixed-bottom `<nav>`) | repo-wide, excluding the primitive | Phase C step 4 (Caregiver) |
| Hover-only states on audited caregiver chrome | shell + caregiver primitives only | Phase C step 4 (Caregiver) |
| Oversized hero radii (`rounded-[2.5rem]/[1.8rem]/[3rem]`) | layout shells only | Phase C step 5 (Family) |
| `glass-card-*` utilities | layout shells only | Phase C step 5 (Family) |
| `backdrop-blur-{xl,2xl,3xl}` on shells | `src/components/layout/` | Phase C step 5 (Family) |
| `hover:` on family chrome | shell + `src/components/family/` | Phase C step 5 (Family) |

Several CI rules are intentionally **shell-scoped**: extending them to the route-page level catches existing offenders that are Phase D scope. Phase D will expand the scopes once the workflow pages migrate.

## Documentation deltas

- `DESIGN_PRINCIPLES.md` gained §11 (wizard primitive convention), §13 (mobile-first cockpit standards — caregiver), and §14 (touch-screen tablet standards — family). §12 forbidden table grew from 11 to 19 entries.
- `ROUTE_COVERAGE.md` gained a `Roles allowed:` line per group, sourced from `ROLES_BY_GROUP` in `scripts/build-route-coverage.mjs`.
- `PATCH_PLAN_PORTALS.md` updated with per-portal completion timestamps + PR links.
- `SEED_DRIFT.md` new ledger tracking demo-auth fixture drift for Phase D repair.

## Baselines

| Portal | Captures | Output |
|--------|---------:|--------|
| Dietary | 6 | `docs/ui-audit/screenshots-phase-c-portals/dietary/` |
| MedTech | 6 | `docs/ui-audit/screenshots-phase-c-portals/medtech/` |
| Onboarding | 6 | `docs/ui-audit/screenshots-phase-c-portals/onboarding/` |
| Caregiver | 9 | `docs/ui-audit/screenshots-phase-c-portals/caregiver/` (8 standard + 1 simulated home-indicator) |
| Family | 6 | `docs/ui-audit/screenshots-phase-c-portals/family/` (tablet viewports only) |

Each portal folder contains a `README.md` documenting the role used for capture and the reproduction command. The Caregiver folder also documents the CSS-injected iPhone home-indicator simulation technique — worth borrowing the next time someone needs to baseline a safe-area-inset interaction in headless Playwright.

## Route-coverage delta

At Phase C close:

| | AUDITED | DRIFT | STUB |
|---|---:|---:|---:|
| Phase B close | 79 | 171 | 173 |
| Phase C close | 153 | 97 | 173 |
| Delta | **+74** | **−74** | 0 |

The classifier scans `page.tsx` only, so the Phase C shell migrations do not directly move the counts — the shift came from the Phase B page sweeps that landed earlier. The audit shipped a regen here to confirm no drift accumulated during the portal-PR cadence.

## What Phase D inherits

- **97 DRIFT route-pages** across the caregiver / family / admin route groups still carry moonshot residue (`glass-card-light`, `rounded-[2.5rem]`, gradient backgrounds, hover-only states). The new CI guardrails would catch them if scopes broaden — Phase D's first decision is how aggressive to make that scope expansion.
- **Seed drift ledger** (`SEED_DRIFT.md`) carries 2 active entries. A single `chore(seed): repair demo auth fixtures` commit closes them.
- **Inline source-side annotations** (`// Metric keys — scanner false positive, see .gitleaksignore`) replaced with a path-scoped `.gitleaks.toml` allowlist — the TODO header in `.gitleaksignore` describes the migration.
- **`HavenDemo2026!` demo password** marked false-positive in GitGuardian for the public repo. If Phase D rotates it, the script fallbacks need to be removed at the same time.

Phase D should start with an explicit plan PR that scopes which of these to bundle. The Phase C cadence (one PR per portal) worked because each portal was a coherent unit; the Phase D work is a sweep across heterogeneous route-pages and risks the "I'll clean up while I'm here" scope creep that produced the original 171-DRIFT undercount. The owner directive: **no auto-progression**.

## Acknowledgements

The five portals were closed in a single calendar day (2026-05-14 → 2026-05-15) using a strict one-PR-per-portal cadence. Each PR landed on first try after one or two CI iterations. Total commits to main across the phase: 5 (one per portal), plus the closeout commit that ships with the final Family PR.
