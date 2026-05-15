# LAYOUT_INVENTORY.md

Read-only snapshot of the layout system as it exists on `claude/brave-merkle-0f0930`. No code changed for this file.

## 1 · Layout file map

| Role | File | Notes |
|------|------|-------|
| Root HTML shell | `src/app/layout.tsx` | Loads `Inter` once, no OpenType features. Body uses `min-h-full font-sans` (no fixed font-size, inherits 16px). Wraps everything in `ThemeProvider` (next-themes, `attribute="class"`, `defaultTheme="system"`). |
| Admin route group | `src/app/(admin)/admin/layout.tsx` | Wraps every authed page in `AdminShell` + `HavenAuthProvider`. |
| Admin shell | `src/components/layout/AdminShell.tsx` | **640 LOC**. Top-bar-only with mega-menu dropdowns. No sidebar. Centered content with `max-w-[1600px] mx-auto p-6 lg:p-10`. |
| Other shells | `CaregiverShell.tsx`, `DietaryShell.tsx`, `FamilyShell.tsx`, `MedTechShell.tsx`, `OnboardingShell.tsx` | Same pattern, each with their own gradient background. |
| Global CSS | `src/app/globals.css` | 375 LOC. Mixed token systems (see §3). |
| Tailwind config | `tailwind.config.ts` | 51 LOC. Imports from `src/design-system/tokens.ts`. |
| Design system tokens | `src/design-system/tokens.ts` | Dark-only RGB palette (`rgb(11 16 28)` app bg, etc.) — does NOT match the CSS-var system. |

## 2 · Top-level page shell wrappers

```tsx
// AdminShell.tsx, line 407 (outer)
<div className="flex flex-col h-screen w-full bg-slate-50 dark:bg-[#050505] font-sans transition-colors duration-300">
```

```tsx
// AdminShell.tsx, line 631 (main content)
<main className="flex-1 overflow-auto relative">
  <div className="relative z-10 w-full h-full p-6 lg:p-10 max-w-[1600px] mx-auto">
    {children}
  </div>
</main>
```

Outer header (line 410):

```tsx
<header className="h-16 flex items-center justify-between px-4 lg:px-8 border-b
  border-slate-200 dark:border-white/5 bg-white/70 dark:bg-black/40
  backdrop-blur-xl z-50 sticky top-0 shrink-0">
```

## 3 · Token systems in use (THREE parallel systems, none authoritative)

1. **OKLCH CSS vars** in `globals.css :root` and `.dark`:
   - `--background: oklch(1 0 0)` / `oklch(0.145 0 0)`
   - `--card: oklch(1 0 0)` / `oklch(0.205 0 0)`
   - `--border: oklch(0.922 0 0)` / `oklch(1 0 0 / 10%)`
   - `--radius: 0.625rem`
2. **Haven-domain HSL/HEX vars** in `globals.css :root` (separate block):
   - `--acuity-1/2/3`, `--severity-1/2/3/4`, `--bed-*`, `--emar-*`, `--compliance-*`
3. **Design-system RGB constants** in `src/design-system/tokens.ts`:
   - `color.bg.app: "rgb(11 16 28)"` (dark only — no light counterpart)
   - Exposed to Tailwind as `bg-app`, `bg-surface`, `text-primary`, etc.

`tailwind.config.ts` consumes only (3). Components in `src/components/...` mix (1) and Tailwind defaults (`slate-50`, `white/70`). The Haven-domain vars (2) are used by status pills only.

## 4 · Navigation pattern

**Top bar only.** No sidebar. At `≥ xl`, a horizontal pill bar renders 7 group dropdowns (`Command / Pipeline / Clinical Ops / Quality & Risk / Knowledge / Workforce / Finance`). Below `xl` (1280px), the nav disappears entirely — leaving only logo, facility scope, search, bell, theme, account.

```tsx
// AdminShell.tsx line 431
<nav className="hidden xl:flex items-center gap-1 bg-slate-100/50 dark:bg-white/[0.03]
  p-1 rounded-2xl border border-slate-200/50 dark:border-white/5">
```

Each pill drops a `DropdownMenuContent` with `w-[320px] rounded-[1.5rem] p-3`.

## 5 · Component primitives in `package.json`

- `@radix-ui/react-{avatar,dialog,label,scroll-area,select,slot,switch}` — partial set, no `@radix-ui/react-tooltip`, `react-tabs`, `react-popover`, `react-navigation-menu`, `react-collapsible`, `react-toolbar`
- `lucide-react@1.7.0` — icon library
- `@tanstack/react-table@8.21.3` + `@tanstack/react-virtual@3.13.24`
- `framer-motion@12.38.0`
- `recharts@3.8.1`
- `shadcn@4.1.1` (CSS import) — shadcn/ui installed but very few primitives generated; `components.json` exists
- `next-themes@0.4.6` — `attribute="class"` strategy

## 6 · Typography stack

- **Single font:** Inter from `next/font/google`, no OpenType `font-feature-settings`
- `--font-sans = --font-display = --font-serif = Inter` (comment in globals.css: "Single font stack (Inter only) — display/serif map to sans")
- Body inherits browser default 16px (no `font-size` set on body)
- Component scale uses Tailwind defaults: `text-xs/sm/base/lg/xl/2xl/4xl/5xl`
- `font-display font-light` used for h1 — line 336 of AdminDashboardPageClient renders `text-4xl md:text-5xl font-display font-light tracking-tight`

## 7 · Spacing scale actually used in JSX

Greppable counts from a sample of admin pages (`AdminShell`, `AdminDashboardPageClient`, `ExecutiveOverviewPageClient`):

- `p-6` / `p-8` / `p-10` — dominant
- `gap-3` / `gap-4` / `gap-6` / `gap-8` / `gap-10` — mixed
- `space-y-8` / `space-y-10` on page roots
- `rounded-[2rem]`, `rounded-[2.5rem]`, `rounded-3xl`, `rounded-4xl`, `rounded-xl`, `rounded-full` — no convention
- `h-16` topbar, `h-14` buttons (oversized for dashboards)

## 8 · Color palette actually used in dashboard JSX

- Backgrounds: `bg-slate-50`, `bg-white/70`, `bg-white/60`, `bg-white/40`, `bg-white/[0.02]`, `bg-black/20`, `bg-black/40`, `bg-[#050505]`, `bg-zinc-950/95`
- Borders: `border-slate-200/50`, `border-slate-100`, `border-white/5`, `border-white/10`
- Text: `text-slate-900`, `text-slate-600`, `text-slate-500`, `text-slate-400`, `text-zinc-200/300/400/500`, `text-white`
- Accent: `bg-indigo-500/10`, `bg-indigo-100/50`, `text-indigo-500/400/300`, `from-indigo-500 to-indigo-600`
- Status: `text-emerald-*`, `text-rose-*`, `text-amber-*` — many opacity variants per state

Count of distinct background utilities in `AdminShell.tsx` + `AdminDashboardPageClient.tsx`: **27**. (For comparison: Linear/Vercel ship dashboards on 4–6 surface tones.)

## 9 · Symptoms catalogued

| Symptom | Location |
|---------|----------|
| Centered content with dead gutters | `AdminShell.tsx:632` `max-w-[1600px] mx-auto` inside `flex-1 overflow-auto` |
| Top-nav-only, no sidebar | `AdminShell.tsx:431-486` |
| Gradient logo with glow | `AdminShell.tsx:419-421` `bg-gradient-to-br from-indigo-500 to-indigo-600 ... shadow-[0_0_15px_rgba(99,102,241,0.4)]` |
| Massive radii | `rounded-[2.5rem]` on page header + inbox card; `rounded-[2rem]` on triage cards |
| Glass effects everywhere | `backdrop-blur-3xl` and `backdrop-blur-xl` on most surfaces |
| `font-display font-light text-5xl` for h1 | `AdminDashboardPageClient.tsx:336` |
| `tracking-widest` micro-caps labels everywhere | `text-[10px] font-bold uppercase tracking-[0.2em]` repeated 12+ times in one file |
| Three parallel token systems | See §3 |
| Hard-coded hex/oklch in components | `dark:bg-[#050505]`, `dark:bg-zinc-950/95` |
| 16px body in a dashboard | No `font-size` set on `body` in `globals.css:257-261` |
| Inter without OpenType features | `globals.css` has no `font-feature-settings` |
| Single-column nav collapses below `xl` | Mega menu requires `xl:flex` |
| KPI cards rendered as `rounded-2xl` shadow-soft hero tiles | `AdminDashboardPageClient.tsx:127-130` skeleton already at `h-36 rounded-[2rem]` |

## 10 · Routes touched by this audit

- `/login` (auth-free, uses `globals.css` directly — visual baseline)
- `/admin` (auth-gated, renders `AdminDashboardPageClient` inside `AdminShell`)
- `/admin/executive` (auth-gated, renders `ExecutiveOverviewPageClient` inside `AdminShell`)

Verifying the dashboard visually requires a Supabase session. The fixes target the shell + tokens; visual proof on `/login` is sufficient to confirm the token system change.
