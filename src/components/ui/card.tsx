import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Card — Quiet Operator surface primitive.
 *
 * Renders a solid, bordered container. NO glassmorphism, NO translucency,
 * NO backdrop-blur (constitution + anti-patterns.md). Separation is earned
 * through padding and a 1px subtle border, not through floating shadows.
 *
 * Hover: a 2px lift (`-translate-y-0.5`) using `--motion-duration` /
 * `--motion-ease`. No scale, no bounce (constitution rule 5).
 *
 * Sizes:
 *   - `default` (10px radius, base padding, base type)
 *   - `sm`      (10px radius, tighter padding/gap)
 *   - `lg`      (14px radius, larger title)
 *
 * Elevation:
 *   - default: `--shadow-card` (subtle inset + drop)
 *   - `elevated`: `--shadow-lift` (deeper drop for raised states)
 *
 * Anti-pattern: do NOT nest Cards. Choose one container. If you find
 * yourself reaching for a nested Card, you want a section divider or
 * a Panel inside the same Card.
 */
type CardSize = "default" | "sm" | "lg"

function Card({
  className,
  size = "default",
  elevated = false,
  ...props
}: React.ComponentProps<"div"> & {
  size?: CardSize
  elevated?: boolean
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-elevated={elevated || undefined}
      className={cn(
        "group/card flex flex-col gap-4 overflow-hidden rounded-[var(--radius)] border border-border bg-card text-card-foreground py-4 lg:py-5 text-sm transition-all duration-[var(--motion-duration)] ease-[var(--motion-ease)] hover:-translate-y-0.5 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 data-[size=lg]:rounded-[var(--radius-md)] data-[size=lg]:gap-5 data-[size=lg]:py-6 shadow-[var(--shadow-card)] data-[elevated=true]:shadow-[var(--shadow-lift)] *:[img:first-child]:rounded-t-[var(--radius)] *:[img:last-child]:rounded-b-[var(--radius)] data-[size=lg]:*:[img:first-child]:rounded-t-[var(--radius-md)] data-[size=lg]:*:[img:last-child]:rounded-b-[var(--radius-md)]",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 px-5 lg:px-6 group-data-[size=sm]/card:px-4 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-base font-semibold leading-snug tracking-tight text-card-foreground group-data-[size=lg]/card:text-lg",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-5 lg:px-6 group-data-[size=sm]/card:px-4", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center border-t border-border bg-muted/40 p-5 lg:p-6 group-data-[size=sm]/card:p-4",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
