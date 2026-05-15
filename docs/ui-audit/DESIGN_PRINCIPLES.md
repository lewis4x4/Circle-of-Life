# DESIGN_PRINCIPLES.md

Locked-in standards for the Haven admin UI. Reviewers MAY block a PR that violates these. The bar is Linear, Vercel, Stripe, Notion, Arc settings, Cursor, Raycast, Superhuman, Height, Pylon, Mercury, Attio — not "an internal tool."

## 1 · App shell

- **Sidebar primary.** Every admin route renders inside `AdminShell` with a fixed 260px left sidebar containing brand, facility scope, grouped nav, and the account footer.
- **Top bar** is 56px (`h-14`), reserved for search (`⌘K`), feedback, notifications, theme, and the page-level breadcrumb slot. It is the only surface allowed to use `backdrop-blur`.
- **Main is full-bleed.** The shell does NOT center the main column. Content cap is `max-w-[1600px]` applied one level deeper, with `px-5 py-5 lg:px-8 lg:py-6 2xl:px-10 2xl:py-8`.
- **No marketing chrome.** Hero cards, gradient pills, `tracking-widest` micro-cap eyebrows ("OPERATIONS HUB"), `text-5xl font-light` titles, and glass-panel page headers are forbidden inside the admin shell.

## 2 · Tokens

- **HSL CSS variables** in `globals.css` are the single source of truth. Components reach for semantic names — `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-secondary`, `bg-primary`, `text-destructive`, `text-success`, `text-warning`, `text-info`.
- **No hardcoded hex/oklch** in components. `dark:bg-[#050505]`, `bg-zinc-950/95`, `bg-white/40` — all forbidden in new code.
- **Light + dark are equivalent.** Every token has both. If you can only style it for one mode, you have not designed it.
- **Haven domain tokens** (`bg-acuity-*`, `bg-emar-*`, `bg-severity-*`) stay for clinical chips; they are not chrome.

## 3 · Typography

- **Inter only**, loaded once, with `font-feature-settings: "cv11", "ss01", "ss03", "cv02"` on `html`.
- **Body 13px / line-height 1.45.** `html` is 14px to give `text-sm` / `text-base` sane defaults; `body` overrides to 13px.
- **Headings tighten.** All h1–h6 get `tracking-tight` and `line-height: 1.2` by default.
- **Title sizes:**
  - h1 (page title): `text-[20px] font-semibold` — never `text-4xl/5xl`.
  - h2 (section): `text-[14px] font-semibold` — section headers are small and bold, not large and light.
  - h3 (card): `text-[14px] font-semibold` to match h2.
- **Numerics are tabular.** Any number rendered in a tile, table, or KPI uses `tabular-nums`. Tables get `font-variant-numeric: tabular-nums` automatically.
- **Caps labels are rare.** One `text-[10px] uppercase tracking-wider text-muted-foreground` per section, max. Never on the page title.

## 4 · Density

- **4px grid.** Use `gap-1` (4), `gap-1.5` (6), `gap-2` (8), `gap-3` (12), `gap-4` (16), `gap-6` (24). Never bespoke pixel values for spacing.
- **Card padding** `p-4` standard, `p-3` for compact rows, `p-5`–`p-6` only for hero/empty-state cards.
- **Row heights** for nav items, dropdown items, table rows: `h-8` (32px) default, `h-9` (36px) when a row contains a button.
- **Button heights:** primary `h-9`, secondary `h-8`, ghost `h-8`, icon-only `size-8`. No `h-12`/`h-14` buttons.
- **KPI tiles:** ~88–104px tall. Number `text-[26px] font-semibold tabular-nums`, label `text-[11px] uppercase tracking-wider text-muted-foreground`, sub-label `text-[11px] text-muted-foreground`.
- **Table rows** `h-9` default. Zebra optional but `hover:bg-secondary/40` is required.

## 5 · Radius

- `rounded` 4, `rounded-md` 6, `rounded-lg` 10 (`var(--radius)`), `rounded-xl` 14, `rounded-2xl` 18. Anything larger is for overlay modals only.
- **No `rounded-[2rem]` / `rounded-[2.5rem]` / `rounded-3xl`+ on cards.** Cards are `rounded-lg` or `rounded-xl`.

## 6 · Borders and shadows

- **Borders are hairlines.** Cards use `border border-border` (1px at `hsl(var(--border))`, ~10% contrast). Stronger borders use `border-border` without opacity.
- **Shadows are restrained.** `shadow-soft` for elevated cards, `shadow-elevated` for popovers. **No** `shadow-2xl`, `shadow-[0_8px_30px_...]`, or bespoke `shadow-[inset_0_0_40px_...]`.
- **No `backdrop-blur` on stationary content.** Topbar may use `backdrop-blur supports-[backdrop-filter]:bg-background/80`. Cards do not.

## 7 · Colour usage

- **Default state:** neutral foreground on neutral background. Status color (success, warning, danger, info) only on the cell carrying the status.
- **Status surface pattern:** `border border-{tone}/30 bg-{tone}/10 text-{tone}` — never `bg-{tone}-50/80` with bespoke shadow.
- **Urgency ring on KPI tiles** is a `2px` left bar (`before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px]`) tinted by tone. No glow halos.

## 8 · Motion

- **Page transitions** are off. No fade-in on route change.
- **Hover transitions** use `transition-colors duration-100` or `duration-150`. No `duration-300+`.
- **Press feedback** (`active:scale-[0.98]`) is reserved for touch-targeted shells (caregiver, family, med-tech). Admin desktop chrome does not animate on press.
- **Reduced motion** is honored — `prefers-reduced-motion: reduce` disables marquees and decorative animations.

## 9 · Focus and accessibility

- **`:focus-visible` ring is global.** `outline: 2px solid hsl(var(--ring)); outline-offset: 2px`.
- Component-level focus ring uses `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` and may add `focus-visible:ring-inset` when the element is inside a tight container.
- **All interactive elements have keyboard focus visible.** No `outline: none` without a ring replacement.
- Icons that carry meaning have `aria-label`. Decorative icons get `aria-hidden`.

## 10 · Iconography

- **Lucide only.** Stroke 1.5, sizes:
  - Body / inline: `size-4` (16)
  - Tables / dense lists: `size-3.5` (14)
  - Section headers: `size-4`
  - Caps labels: `size-3` or `size-3.5`
- **No emoji** in chrome.
- **No gradient icons.** No `shadow-[0_0_15px_...]` glow.

## 11 · Components

- **Buttons** use `cn` with strict variant classes — `bg-foreground text-background` (primary), `border border-border bg-card text-foreground` (secondary), `text-muted-foreground hover:text-foreground` (ghost), `border-destructive/40 bg-destructive/10 text-destructive` (destructive).
- **Inputs** are `h-9 rounded-md border border-input bg-card px-2.5 text-[13px]` with `focus-visible:ring-2 ring-ring`.
- **Pills/chips** are `h-5 inline-flex items-center rounded border px-1.5 text-[10px] font-medium uppercase tracking-wider`.
- **Tables** use `@tanstack/react-table` and the `DataTable` primitive in `src/design-system/components/DataTable`.
- **Empty states** are `border-dashed border-border/80 rounded-lg p-10 text-center` with one short sentence and one icon at 60% opacity.
- **Multi-step flows** (onboarding, admissions wizard, settings migration, intake) use the `WizardSteps` / `WizardStep` primitive in `src/components/ui/wizard-steps.tsx`. Never hand-roll a `Step N of M` indicator inside a page. The primitive owns the indicator chrome (`h-8 sm:h-9` numbered circles), the connector line between steps, the three states (`complete` / `current` / `upcoming`) keyed off semantic tokens (`bg-primary`, `bg-muted`, `ring-ring`), and the mobile collapse (`hidden sm:inline` labels under `640px`). The consumer passes `state` per step — the primitive does not infer progress. CI enforces this at `.github/workflows/style-regression.yml`.

  ```tsx
  <WizardSteps aria-label="Onboarding progress">
    <WizardStep label="Overview" state="complete" href="/onboarding" />
    <WizardStep label="Departments" state="current" href="/onboarding/departments" />
    <WizardStep label="Questions" state="upcoming" href="/onboarding/questions" />
  </WizardSteps>
  ```

## 12 · What's forbidden in admin chrome

| ❌ Forbidden | ✅ Use instead |
|---|---|
| `rounded-[2rem]`, `rounded-[2.5rem]`, `rounded-4xl` on cards | `rounded-lg` / `rounded-xl` |
| `bg-white/40 backdrop-blur-3xl` page headers | flat `<div>` with the title only |
| Gradient logos (`bg-gradient-to-br`) | flat `bg-foreground text-background` mark |
| `text-4xl/5xl font-display font-light` h1 | `text-[20px] font-semibold` |
| `text-[10px] uppercase tracking-widest` page-level eyebrow | drop it |
| `glass-card` / `glass-panel` on admin pages | plain `bg-card border-border` |
| `h-12`–`h-14` buttons inside the app | `h-8`–`h-9` |
| `dark:bg-[#050505]`, `bg-zinc-950/95`, `dark:bg-white/[0.02]` | semantic tokens (`bg-background`, `bg-card`, `bg-muted`) |
| `shadow-[0_8px_30px_rgba(...)]` bespoke shadows | `shadow-soft` / `shadow-elevated` |
| `ALL CAPS` button labels | sentence case |
| `font-display font-light` | `font-semibold` |
| Hand-rolled `Step N of M` indicators in JSX | `<WizardSteps>` / `<WizardStep>` from `@/components/ui/wizard-steps` |

## 13 · PR review checklist

Reviewers run this before merging anything visual:

1. Does the change render in **both** light and dark mode?
2. Are all colors token-driven (no `dark:bg-[#…]`, no `bg-slate-X`)?
3. Is the body text `text-[13px]` or smaller in chrome, never `text-base`?
4. Are radii at most `rounded-xl` on cards?
5. Are buttons at most `h-9`?
6. Is there a `focus-visible:ring-2 focus-visible:ring-ring` on every interactive element?
7. Are numerics `tabular-nums`?
8. Is there at most one caps label per section?
9. Does the page fill the viewport at `≥ 1440px` with no centered gutters on the shell?
10. Does the page work at 1280px without truncating navigation?

If any answer is no, the change is not ready.
