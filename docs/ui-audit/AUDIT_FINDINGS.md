# AUDIT_FINDINGS.md

Reference bar: Linear, Vercel, Stripe, Notion, Arc settings, Cursor, Raycast, Superhuman, Height, Pylon, Mercury, Attio. Findings are graded against that bar — "functional" is below the line.

Severity scale: **Critical** (the thing the user complains about), **High** (compounds the dated feel), **Medium** (polish gap).

---

## CRITICAL · structural / blocking

### C1 — Top-nav-only shell creates dead gutters and disappears under 1280px
**File:** [src/components/layout/AdminShell.tsx:407-635](src/components/layout/AdminShell.tsx:407)

**Current (the culprit):**
```tsx
<div className="flex flex-col h-screen w-full bg-slate-50 dark:bg-[#050505] ...">
  <header className="h-16 ...">…7 mega-menu dropdowns…</header>
  …
  <main className="flex-1 overflow-auto relative">
    <div className="relative z-10 w-full h-full p-6 lg:p-10 max-w-[1600px] mx-auto">
      {children}
    </div>
  </main>
</div>
```

**Why it reads dated:**
- `max-w-[1600px] mx-auto` inside a full-width main causes dead gutters at ≥ 1700px screens.
- Mega-menu sits under `xl:flex` (1280px) — at 1280px and below the entire navigation disappears.
- 7 horizontal dropdown groups force users to discover navigation through hover, instead of seeing it.
- Linear/Vercel/Stripe/Notion/Cursor/Raycast/Attio all ship sidebar-primary shells. This is not a stylistic choice — it's the dominant pattern for dashboard apps.

**Fix:** Rewrite the shell to `flex-row` with a 260px sidebar + 56px topbar + full-bleed scrolling main (max 1600px content cap, but no centered gutters on the shell). Patched in `src/components/layout/AdminShell.tsx`.

---

### C2 — Three competing token systems; no single source of truth
**Files:**
- [src/app/globals.css:7-155](src/app/globals.css:7) (OKLCH `@theme inline` + duplicate `:root`)
- [src/design-system/tokens.ts:1-91](src/design-system/tokens.ts:1) (RGB constants, dark-only)
- [tailwind.config.ts:6-46](tailwind.config.ts:6) (consumes only tokens.ts)

**Why it reads dated:** Components reach for raw Tailwind utilities (`bg-slate-50`, `bg-white/70`, `dark:bg-[#050505]`) because no token names cover both light and dark. Result: 27 distinct background utilities in two files; no two surfaces use the same elevation rule.

**Fix:** Collapse to a single HSL token system in `globals.css`, expose via `tailwind.config.ts`, retire the RGB-only `tokens.ts` (kept as legacy with explicit notice). Components use `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border` — same in light and dark.

---

### C3 — Body font-size unset; dashboard renders at 16px
**File:** [src/app/globals.css:257-261](src/app/globals.css:257)

**Current:**
```css
body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
}
```

**Why it reads dated:** 16px is a marketing-site default. Linear/Notion/Stripe ship dashboards at 13–14px. Every information row in an app feels twice as fluffy without it.

**Fix:** Body becomes 13px with `1.45` line-height, `text-foreground`, `antialiased`. Headings and body content opt up to 14px via component classes where readability requires it.

---

### C4 — Inter loaded without OpenType features
**Files:** [src/app/layout.tsx:7-10](src/app/layout.tsx:7), [src/app/globals.css:298-307](src/app/globals.css:298)

**Current:** No `font-feature-settings` declared anywhere.

**Why it reads dated:** Inter's tabular-nums (`cv11`), simplified alts (`cv02`), and stylistic sets (`ss01`, `ss03`) are the single biggest "feels like Linear" tell. Without them, numerals look unbalanced in tables and KPI tiles.

**Fix:** Add `font-feature-settings: "cv11", "ss01", "ss03", "cv02"` to `html` in globals.css.

---

### C5 — Page header is a hero card with `text-5xl font-display font-light` + gradient pill
**File:** [src/components/admin/AdminDashboardPageClient.tsx:331-345](src/components/admin/AdminDashboardPageClient.tsx:331)

**Current:**
```tsx
<div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40
  dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5
  backdrop-blur-3xl shadow-sm">
  <div className="space-y-2">
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-100/50 …
      text-[10px] font-bold uppercase tracking-widest text-indigo-800">
       <Zap className="w-3.5 h-3.5" /> Operations Hub
    </div>
    <h1 className="text-4xl md:text-5xl font-display font-light tracking-tight ... flex items-center gap-4">
      Command Center
    </h1>
```

**Why it reads dated:**
- "Hero card" wrapper around the page title (with `rounded-[2.5rem]` and `backdrop-blur-3xl`) is a marketing pattern, not an app pattern.
- `text-5xl font-light` makes the title look like a landing page banner.
- The `Operations Hub` micro-cap pill with `tracking-widest` reads as 2017–2019 "SaaS dashboard" aesthetic.
- Combined with the gradient logo (`AdminShell.tsx:419`), this is the strongest "dated" signal on the page.

**Fix:** Strip the hero wrapper. h1 becomes `text-[20px] font-semibold tracking-tight`, subtitle becomes `text-sm text-muted-foreground`, micro-cap pill removed (the page title carries the meaning).

---

## HIGH · cumulative dated tells

### H1 — Gradient logo with cyan glow
**File:** [src/components/layout/AdminShell.tsx:419-421](src/components/layout/AdminShell.tsx:419)

```tsx
<div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600
  flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.4)]">
  <span className="text-white font-display font-bold text-lg leading-none mt-0.5">H</span>
</div>
```

**Fix:** Replace with a flat 28×28 mark using `bg-foreground text-background`. No gradient, no glow.

---

### H2 — Massive border radii on cards
Pattern repeats: `rounded-[2.5rem]`, `rounded-[2rem]`, `rounded-3xl`, `rounded-4xl`.

**Files:**
- `AdminDashboardPageClient.tsx:331` `rounded-[2.5rem]` (header)
- `AdminDashboardPageClient.tsx:363` `rounded-[2rem]` (priorities)
- `AdminDashboardPageClient.tsx:570` `rounded-[2.5rem]` (inbox card)
- `AdminDashboardPageClient.tsx:127,128,129,130` `rounded-[2rem]` skeletons
- `AdminDashboardPageClient.tsx:140` `rounded-[2.5rem]` error state

**Fix:** Cards use `rounded-xl` (12px). Tiles use `rounded-lg` (10px). Only modal-style overlays use `rounded-2xl`.

---

### H3 — `backdrop-blur-3xl` glass-panel chrome everywhere
Pattern: `bg-white/40 dark:bg-black/20 backdrop-blur-3xl` on stationary content.

**Why it's dated:** Apple-style glass works for floating overlays. On a stationary card, it costs GPU time and looks like a 2014 dashboard. Linear/Vercel/Stripe use solid surfaces with a single soft border or hairline ring.

**Fix:** Cards become `bg-card border border-border/60` with zero blur. Reserved blur for the topbar only.

---

### H4 — KPI tiles use card-style padding (`p-6`–`p-8`) and `h-36` skeletons
**File:** [src/components/admin/AdminDashboardPageClient.tsx:127-130](src/components/admin/AdminDashboardPageClient.tsx:127)

**Why it's dated:** Linear KPI tiles are roughly `h-28` with a 2xl semibold number, tiny uppercase label, and no card chrome. Haven's tiles are tall (`h-36`), padded (`p-6`+), and use heavy radii — they read like marketing feature cards.

**Fix:** New `TriageMetricCard` chrome: `rounded-lg border border-border/60 bg-card p-4`, number `text-2xl font-semibold tabular-nums tracking-tight`, label `text-[11px] font-medium uppercase tracking-wider text-muted-foreground`.

---

### H5 — `tracking-widest` micro-caps used as filler decoration
Search hit: 12+ instances of `text-[10px] font-bold uppercase tracking-[0.2em]` and `tracking-widest` in `AdminDashboardPageClient.tsx` alone.

**Why it's dated:** The repeating tiny-caps eyebrow ("Operations Hub", "Facility Priorities", "Recent Critical Activity", "Resident Assurance", "Signed In", "Active Shift", "Zone") creates a 2018-era "premium" feel. World-class apps use one caps label per section at most, often none.

**Fix:** Remove all but one per section. Survive: section header eyebrows on KPI groupings.

---

### H6 — `space-y-10 pb-12` page rhythm; 6-card row at `xl:grid-cols-6`
**File:** [src/components/admin/AdminDashboardPageClient.tsx:328](src/components/admin/AdminDashboardPageClient.tsx:328), [444](src/components/admin/AdminDashboardPageClient.tsx:444)

**Why it's dated:** 40px vertical rhythm makes the page feel sparse. 6-column KPI rows result in cramped labels at typical widths.

**Fix:** Page rhythm becomes `gap-6` (24px) for sections, `gap-3` (12px) within a section. KPI grids cap at 4 columns on `xl`, 5 on `2xl`.

---

### H7 — Inline "RETRY CONNECTION" button + amber glass error state
**File:** [src/components/admin/AdminDashboardPageClient.tsx:138-154](src/components/admin/AdminDashboardPageClient.tsx:138)

`h-14 px-8 rounded-2xl ... font-bold tracking-wide shadow-[0_4px_20px_rgba(245,158,11,0.15)] bg-amber-500 text-amber-950 hover:bg-amber-400`

**Why it's dated:** 56px-tall ALL-CAPS button with bespoke shadow inside a `rounded-[2.5rem]` blurred amber card. Reads like a CTA on a 2016 product page.

**Fix:** Standard secondary button (`h-9`, sentence case, neutral chrome), card becomes the standard error-card with destructive border accent.

---

### H8 — `font-display font-light` for h1/h2 inside the dashboard
Multiple instances of `font-display font-medium text-xl` and `font-display font-light text-5xl`.

**Why it's dated:** `font-display` resolves to Inter in this codebase (line 10 of globals.css: "display/serif map to sans for fewer network requests"). The token name implies a separate display face that doesn't exist. The styling — large + light-weight — is a marketing-site move; app headers use semibold + small.

**Fix:** Drop `font-display` everywhere; standardize on `font-semibold` for h1/h2.

---

## MEDIUM · polish

### M1 — `glass-panel`, `glass-card`, `glass-card-light` utilities still defined
**File:** [src/app/globals.css:198-205,218-222](src/app/globals.css:198)

Defined but only used for legacy gradient shells. Patch retains them with a deprecation comment.

### M2 — `caregiver-shell` / `family-shell` radial gradient backgrounds
**File:** [src/app/globals.css:188-216](src/app/globals.css:188)

Not in scope of admin audit but document: same "moonshot gradient" aesthetic applied to caregiver + family routes.

### M3 — `tap-responsive` is `transition-transform duration-150 active:scale-[0.98]`
**File:** [src/app/globals.css:226-228](src/app/globals.css:226)

The 98% active-state press effect is iOS-app pattern; on desktop dashboards Linear/Vercel use no press-scale and rely on focus rings + bg shift only. Low impact, leave but stop applying to dense rows.

### M4 — `::-webkit-scrollbar` styled with `--color-brand-200` / `--color-brand-800`
**File:** [src/app/globals.css:309-341](src/app/globals.css:309)

Dated browser-specific styling; modern apps either use OS scrollbars or `scrollbar-gutter: stable`. Leave as-is (low blast radius) but document.

### M5 — No focus-visible ring conventions; reliance on `focus-visible:ring-2 ring-indigo-500/80`
Spot-checked across `AdminShell.tsx` — most interactive elements use `tap-responsive outline-none` without a focus-visible ring.

**Fix:** Globals.css adds default `*:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px }` plus `outline-none` only where Tailwind ring replaces it.

### M6 — No skeleton convention; Skeleton tiles use `rounded-[2rem] bg-slate-200 dark:bg-white/5`
Already imported `Skeleton` primitive; just needs to be tightened to match new card radii.

---

## Severity rollup

| Sev | Count |
|-----|-------|
| Critical | 5 |
| High | 8 |
| Medium | 6 |
| **Total** | **19** |

The single highest-leverage edit is **C1 + C5 together** — replacing the top-nav-only shell with a sidebar shell, and removing the hero-card page header. Every page in the admin route group benefits immediately.
