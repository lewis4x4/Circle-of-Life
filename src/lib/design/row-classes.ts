/**
 * Canonical class strings for Quiet Operator Table / List / Queue surfaces.
 *
 * Spec source: HANDOFFS/2026-05-16__haven-alf-operations__visual-forge-handoff
 *   - surface-map.md §Table/List + §Inbox / Work Queue:
 *     Row height = 36px · Padding = 13px · Border radius = 8px · Hover lift = 1-2px
 *   - component-rules.md §Tables rule 1: row height matches per-surface density
 *   - constitution.md rule 6: tables and lists default to data density
 *
 * Hard constraints (binding):
 *   - The row container is exactly 36px tall (`h-9`). NO vertical padding on
 *     the row itself — the cell content sits on the row's intrinsic baseline.
 *   - Horizontal padding is 13px (`px-[13px]`).
 *   - Hover applies a 1px lift (`hover:-translate-y-0.5`) and a background
 *     swap (`hover:bg-muted/40`). Per component-rules.md §Tables rule 1:
 *     "Hover changes background, not lift" — the lift is held to 1px so the
 *     change is barely perceptible, prioritising the background cue.
 *   - All transitions ride `--motion-duration-micro` (100ms) on the project
 *     `--motion-ease` curve — operator-grade micro motion.
 *   - Focus uses the standard 2px ring against `bg-card`, no offset (the row
 *     is already on a panel).
 *
 * Use TABLE_ROW_CLASS for the row container (`<Link>` / `<button>` / `<a>` /
 * `<div role="row">`). Children should be `flex-[N]` columns sized in
 * relative units, single-line, NO stacked "label + value" inside the row.
 * Render column labels in a separate TABLE_HEADER_CLASS row above.
 *
 * Status indicators inside the row MUST use the StatusPill primitive
 * (dot + label) — never a label-only chip (component-rules.md §Tables rule 3).
 */
export const TABLE_ROW_CLASS =
  "flex items-center gap-3 h-9 px-[13px] rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0";

/**
 * Companion header row for Table / List surfaces. Sits directly above the
 * data rows inside the surrounding panel. Picks up the same horizontal
 * rhythm (`px-[13px]`) and uses caption typography — 10px uppercase tracked
 * muted — per component-rules.md §Tables rule 2.
 */
export const TABLE_HEADER_CLASS =
  "flex items-center gap-3 h-8 px-[13px] border-b border-border bg-card/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";
