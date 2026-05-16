import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * Input — Quiet Operator text input primitive (component-rules.md §Inputs).
 *
 * Surface: `bg-background` with a 1px `--border` (warm near-black). The
 * input renders DISTINCT from its parent card surface (`bg-card`) so the
 * field is visually identified without decorative shadow.
 *
 * Focus: 3px ring via `focus-visible:ring-3 focus-visible:ring-ring/50`.
 * The border color is NOT changed on focus — competing color cues blur the
 * 3px glow signal. Border carries the field; ring carries the focus.
 *
 * Required fields:
 *   - Pass `required` (or `aria-required`) — HTML emits the programmatic
 *     announcement automatically.
 *   - Consumers MUST render a visible asterisk in the associated `<Label>`.
 *     The primitive does not render decorative markers; visible required
 *     indication is a label concern.
 *
 * Error:
 *   - Apply `aria-invalid="true"` (or `aria-invalid` boolean) on the input.
 *     `--destructive` border + 3px destructive ring are applied automatically.
 *   - Render a single line of help text BELOW the field in body-sm muted
 *     (`text-sm text-muted-foreground`). NEVER italic.
 *
 * Density: `h-9` (36px) matches operational table-row density per the
 * surface map. Do not compress further; do not exceed 40px without cause.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-[var(--radius)] border border-input bg-background px-3 py-1 text-base transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
