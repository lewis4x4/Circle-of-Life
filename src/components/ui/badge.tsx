import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Badge — Quiet Operator neutral chip primitive.
 *
 * Anti-pattern enforcement (anti-patterns.md): "Pill badges in primary colors"
 * is forbidden. The brand accent is reserved for the one accent surface
 * (component-rules.md §Buttons §1 — `<Button variant="default">`). Badges are
 * neutral metadata chips by default.
 *
 * Typography: sentence-case, calm. NO mono, NO uppercase, NO tracking-widest.
 * Hierarchy comes from weight (`font-medium`), not from shouting.
 *
 * Variants (chrome / shape):
 *   - `default`     Neutral chip. `bg-muted/40` warm wash + 1px `--border`.
 *   - `secondary`   Subtler than default. Transparent background, muted text.
 *   - `outline`     Transparent background, neutral foreground (text-foreground).
 *   - `destructive` Severity chip — keeps the `bg-destructive/10` color cue
 *                   because severity meaning warrants color (constitution
 *                   rule 4 — color used for clinical meaning, not aesthetics).
 *   - `ghost`       Pure text chip, hover reveals muted wash.
 *   - `link`        Inline underline action (kept for backward compat).
 *
 * Tones (severity-meaning overlay — orthogonal to variant):
 *   - `tone="none"`     (default) — no tone applied.
 *   - `tone="warning"`  Amber chip.
 *   - `tone="success"`  Green chip.
 *   - `tone="info"`     Steel-blue info chip (NOT brand emphasis; the info
 *                       hue is a separate semantic from `--primary`).
 *
 *   Tones override `variant` colors when set. Use tones for clinical /
 *   compliance / severity meaning ONLY. NEVER for brand emphasis or
 *   decorative variety.
 *
 * Migration:
 *   - Old: `<Badge variant="default">42</Badge>` — used to render a
 *     primary-color pill (`bg-primary/10 text-primary`). That treatment was an
 *     anti-pattern and has been retired.
 *   - For brand-emphasis call-outs (e.g. "Active" status tag), prefer
 *     `<StatusPill>` (dot + label) or `<Badge tone="success">`.
 *   - For button-shaped brand emphasis (small CTA), use
 *     `<Button size="xs" variant="default">`.
 *   - For neutral metadata (counts, tags), keep `<Badge variant="default">`
 *     — semantics have shifted from brand → neutral, treatment is now calm.
 *
 * Height: 22px (`h-[22px]`) — the calmer rhythm of Quiet Operator chips.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--radius-sm)] border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all duration-[var(--motion-duration)] ease-[var(--motion-ease)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "border-border bg-muted/40 text-foreground [a]:hover:bg-muted/60",
        secondary:
          "border-border bg-transparent text-muted-foreground [a]:hover:bg-muted/40 [a]:hover:text-foreground",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive focus-visible:ring-destructive/20 [a]:hover:bg-destructive/20",
        outline:
          "border-border bg-transparent text-foreground [a]:hover:bg-muted/40",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      tone: {
        none: "",
        warning:
          "border-warning/30 bg-warning/10 text-warning [a]:hover:bg-warning/20",
        success:
          "border-success/30 bg-success/10 text-success [a]:hover:bg-success/20",
        info: "border-info/30 bg-info/10 text-info [a]:hover:bg-info/20",
      },
    },
    defaultVariants: {
      variant: "default",
      tone: "none",
    },
  }
)

function Badge({
  className,
  variant = "default",
  tone = "none",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, tone }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
      tone,
    },
  })
}

export { Badge, badgeVariants }
