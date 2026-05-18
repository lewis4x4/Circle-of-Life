"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Button — Quiet Operator primary action primitive.
 *
 * Variants (component-rules.md §Buttons):
 *   - `default`     Primary. `bg-primary` + dark text + `font-semibold`.
 *                   Hover brightens to `--accent-hover` and adds `--shadow-glow`.
 *   - `outline` /
 *     `secondary`   Ghost: transparent background, 1px `--border-strong`.
 *                   These two variants are aliases — both render the same
 *                   ghost-with-strong-border treatment per Quiet Operator
 *                   ("Secondary buttons are ghost (transparent background,
 *                   1px strong border)"). Consumers may continue using
 *                   `variant="secondary"` without code changes.
 *   - `ghost`       No border, no background. Hover reveals a muted wash.
 *   - `destructive` Full danger fill — used for irreversible primary actions
 *                   (delete, revoke). NOT the soft `bg-destructive/10` pattern
 *                   (that's for chips / badges, not buttons).
 *   - `neutralCta` Neutral charcoal operator action — fills from `--chrome-*`
 *                   (anchors to chrome, not saturated brand). Prefer this over
 *                   `default` when `bg-primary` would read like a semantic
 *                   clinical/state color on Quiet Operator canvases (see
 *                   constitution § color semantics).
 *   - `link`        Underlined inline text action.
 *
 * Sizes (component-rules.md §Buttons §3):
 *   Default padding is 10px vertical, 16px horizontal (px-4 py-2.5).
 *   xs / sm / lg / icon variants scale proportionally.
 *
 * Radius:
 *   All variants use `--radius` (10px). No `rounded-lg` or arbitrary radii.
 *
 * Disabled: opacity drops to 0.4; `disabled:pointer-events-none` neutralizes
 * hover. Do not add manual `disabled:hover:*` overrides.
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-[var(--radius)] border border-transparent text-sm font-medium whitespace-nowrap normal-case tracking-normal transition-all duration-[var(--motion-duration)] ease-[var(--motion-ease)] outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground font-semibold hover:bg-[var(--accent-hover)] hover:shadow-[var(--shadow-glow)]",
        outline:
          "border-[var(--border-strong)] bg-transparent text-foreground hover:bg-muted/40 aria-expanded:bg-muted/40",
        secondary:
          "border-[var(--border-strong)] bg-transparent text-foreground hover:bg-muted/40 aria-expanded:bg-muted/40",
        ghost:
          "bg-transparent hover:bg-muted/40 hover:text-foreground aria-expanded:bg-muted/40 aria-expanded:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90 focus-visible:ring-destructive/30",
        neutralCta:
          "border-transparent bg-[hsl(var(--chrome-primary))] text-[hsl(var(--chrome-foreground))] font-semibold shadow-none hover:bg-[hsl(var(--chrome-active))] hover:shadow-none dark:hover:shadow-none",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-4 py-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 px-3 py-1.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3.5 py-2 text-[0.8rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-5 py-3 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-9",
        "icon-xs":
          "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
