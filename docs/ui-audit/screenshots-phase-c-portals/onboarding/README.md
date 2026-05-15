# Onboarding baselines — Phase C step 3

## Capture role

`/onboarding` is gated by the Edge middleware to one of:

- `onboarding` (dedicated activation role)
- `owner` / `org_admin` (org-level admins, who oversee onboarding for their org)

See `src/lib/auth/onboarding-shell.ts:onboardingShellAccessRedirect` and `ROUTE_COVERAGE.md` → Onboarding group for the canonical list.

Baselines were captured as the owner account so the same harness/credentials that ship the rest of the audit's owner-role baselines could be reused:

- Email: `milton.smith@circleoflifealf.com`
- `app_role`: `owner`
- Supabase user id: `a0000000-0000-0000-0000-000000000001`

Reproduce with:

```bash
SCREENSHOT_USER_EMAIL=milton.smith@circleoflifealf.com \
ROUTES_JSON='[{"id":"onboarding","path":"/onboarding"}]' \
SCREENSHOT_OUT_DIR=docs/ui-audit/screenshots-phase-c-portals/onboarding \
SETTLE_MS=3000 \
node scripts/screenshot-dashboard.mjs
```

## What the images show

Each PNG renders the **migrated shell chrome**:

- Header (`bg-background/95` with `backdrop-blur` and `border-border`) replacing the old `bg-slate-950/90` marketing-tone bar.
- `ShieldCheck` indicator in a `rounded-lg bg-primary/10 ring-1 ring-primary/30` plate (was `rounded-xl bg-teal-500/15 ring-teal-400/40`).
- Eyebrow `text-[11px] uppercase tracking-wider text-muted-foreground` (was `text-xs uppercase tracking-[0.16em] text-slate-400`).
- H1 `text-xl font-semibold tracking-tight text-foreground` (was `font-display text-xl font-semibold tracking-tight text-white`).
- "Shared access (temporary)" `Badge variant="outline"` (was raw `bg-amber-500/20 text-amber-100`).
- Sign-out button uses the shared `buttonVariants({ variant: "outline" })` chrome (was hand-rolled `border-white/20 bg-transparent`).
- **`WizardSteps`** primitive in place of the three nav buttons — numbered circles, connector lines, three states (`complete` / `current` / `upcoming`) keyed off semantic tokens. Same primitive will be reused for every multi-step flow going forward; see `docs/ui-audit/DESIGN_PRINCIPLES.md` §11 and `src/components/ui/wizard-steps.tsx`.

The "Loading overview…" pill below the header is the page's own data-hydration state (from `useOnboardingStore`), not the shell. It still renders a teal Loader2 — that color comes from the page, not the shell, and is out of scope for this PR (per `PATCH_PLAN_PORTALS.md` "Out of this plan").

## Light vs dark

Onboarding does **not** force a theme. The shell follows the user's `next-themes` preference. Both modes render correctly because every chrome color is a semantic token (`bg-background`, `text-foreground`, `border-border`, `bg-primary`, `bg-muted`, `text-muted-foreground`, `ring-ring`) — flip the theme, the variant resolves automatically.

Compare `onboarding-1440x900-light.png` to `onboarding-1440x900-dark.png`: the numbered indicator for the active step inverts cleanly (dark filled circle on light bg → light filled circle on dark bg).

## Files

| Viewport | Theme | File |
|----------|-------|------|
| 1440×900 | light | `onboarding-1440x900-light.png` |
| 1440×900 | dark | `onboarding-1440x900-dark.png` |
| 1920×1080 | light | `onboarding-1920x1080-light.png` |
| 1920×1080 | dark | `onboarding-1920x1080-dark.png` |
| 2560×1440 | light | `onboarding-2560x1440-light.png` |
| 2560×1440 | dark | `onboarding-2560x1440-dark.png` |
