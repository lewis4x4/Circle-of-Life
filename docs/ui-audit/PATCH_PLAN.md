# PATCH_PLAN.md

Ordered smallest-blast-radius-first. Each step lands as one commit so it can be reverted independently.

## Order of operations

1. **`globals.css` — HSL token system + body density + OpenType.**  
   *Blast radius:* every page. Reversible by reverting one file.

2. **`tailwind.config.ts` — expose HSL tokens to utilities.**  
   *Blast radius:* every page. Old `bg-app`, `text-primary` etc. classes stay backward-compatible; new `bg-background`, `bg-card` semantic names added.

3. **`src/components/layout/AdminShell.tsx` — sidebar + topbar rewrite, full-bleed main.**  
   *Blast radius:* every admin route. Replaces the centered max-w-1600 wrapper.

4. **`src/components/admin/AdminDashboardPageClient.tsx` — page header chrome.**  
   *Blast radius:* `/admin` only. Header + KPI tile chrome → flat cards.

5. **`docs/ui-audit/DESIGN_PRINCIPLES.md` — lock in the standards.**  
   *Blast radius:* documentation only. Required to prevent regression.

## Step 1 — globals.css

Replace the `@theme inline`, `:root`, and `.dark` blocks with a single HSL-based token system. Keep Haven-domain status tokens (acuity/severity/bed/emar/compliance) — those are already correct.

- New `:root` defines: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--success`, `--warning`, `--info`, `--border`, `--input`, `--ring`, `--radius`
- `.dark` overrides the same set
- `@layer base { html { font-feature-settings: "cv11","ss01","ss03","cv02"; font-size: 13px; } body { @apply bg-background text-foreground antialiased; line-height: 1.45; } }`
- Retain `.glass-card`, `.glass-panel`, `.caregiver-shell`, `.family-shell`, `.tap-responsive`, animation keyframes, scrollbar styles, landing-noise — all marked as legacy/preserved.

## Step 2 — tailwind.config.ts

- Add `darkMode: ['class']` so `.dark` controls theme (matches next-themes).
- Add color tokens that read `hsl(var(--foo))` for: `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `destructive-foreground`, `border`, `input`, `ring`.
- Keep existing `app`, `surface`, `text-primary`, etc. from `tokens.ts` — these are referenced by v2 design-system components; leave them backward-compatible.
- Add `borderRadius` using `var(--radius)` for `lg`, `md`, `sm`.
- Add `container` config: `{ center: false, padding: '0' }` — explicitly off so nothing centers itself silently.

## Step 3 — AdminShell.tsx rewrite

New structure:

```
<div class="flex h-dvh w-full overflow-hidden bg-background text-foreground">
  <aside class="hidden lg:flex w-[260px] shrink-0 flex-col border-r border-border/60 bg-card/40">
    <Brand />
    <FacilityScope />
    <Nav />           ← grouped, scrollable, every link visible
    <Footer />
  </aside>
  <div class="flex flex-1 flex-col min-w-0">
    <Topbar class="h-14 shrink-0 border-b border-border/60">
      <PageBreadcrumb /> <Spacer /> <Search /> <Feedback /> <Bell /> <ThemeToggle /> <AccountMenu />
    </Topbar>
    <SurveyVisitModeBar />          ← preserved
    <main class="flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-[1600px] px-6 py-6 2xl:px-10 2xl:py-8">
        {children}                  ← inner cap keeps content readable but main is full-bleed
      </div>
    </main>
  </div>
</div>
```

Behavior preserved:
- Facility scope dropdown logic (`useFacilityStore`, `refreshFacilities`, `handleFacilityScopeChange`)
- Auth/sign-out (`useHavenAuth`, `handleSignOut`, `getRoleDashboardConfig`)
- Role-based nav filtering (`roleConfig.visibleGroups`, `visibleItemKeys`)
- Active-route detection
- Theme toggle (next-themes)
- `SurveyVisitModeBar`, `PilotFeedbackLauncher`

Behavior dropped:
- Top-nav mega-menu pill bar (replaced by sidebar)
- Gradient logo
- "Moonshot" backdrop-blur chrome

Mobile/tablet: sidebar hidden, hamburger toggles a Radix Dialog drawer with the same nav. (Hamburger uses `Menu` from lucide.)

## Step 4 — AdminDashboardPageClient header chrome

- Remove the `rounded-[2.5rem] backdrop-blur-3xl bg-white/40` hero wrapper around the title.
- h1: `text-[20px] font-semibold tracking-tight text-foreground`.
- Subtitle: `mt-1 text-sm text-muted-foreground`.
- Right-side "Active Shift" + "Zone" chip becomes one slim inline pill: `inline-flex h-7 items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 text-[11px] text-muted-foreground tabular-nums`.
- Remove `Operations Hub` eyebrow caps pill.
- Triage card grids: `grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4`.
- Workflow Convergence row: keep 6-up but constrain to `xl:grid-cols-3 2xl:grid-cols-6` so it never crams.
- Error state: standard card chrome, `Button` secondary, sentence-case `Retry`.

## Step 5 — DESIGN_PRINCIPLES.md

Standards locked in (see file). The runbook is read at PR time.

## Out-of-scope but flagged

- ExecutiveOverviewPageClient.tsx (same patterns, can be patched in a follow-up)
- CaregiverShell / DietaryShell / FamilyShell / MedTechShell / OnboardingShell — each has its own gradient theme not addressed here
- shadcn primitive coverage gap (no Tooltip, Tabs, Popover, NavigationMenu, Collapsible, Toolbar) — flagged but not added in this audit pass

## Rollback

Any single step can be reverted by `git revert <commit>`. Steps 1+2 should revert together (token names and HSL definitions are coupled). Steps 3+4 can revert independently.
