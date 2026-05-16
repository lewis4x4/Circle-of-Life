import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Textarea — Quiet Operator multi-line input primitive.
 *
 * Mirrors the `<Input>` contract:
 *   - `bg-background` + 1px `--border` so the field is distinct from its
 *     parent card surface.
 *   - Focus reveals a 3px ring (no competing border color shift).
 *   - `aria-invalid="true"` flips to `--destructive` border + 3px destructive ring.
 *   - Required-field visual indication is a `<Label>` concern (asterisk); the
 *     primitive renders the programmatic `aria-required` if `required` is set.
 *
 * Help / error text below the field uses body-sm muted (`text-sm
 * text-muted-foreground`). NEVER italic.
 *
 * `min-h-[72px]` matches the operational density for 3-line affordances
 * without crowding the row above.
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "flex min-h-[72px] w-full rounded-[var(--radius)] border border-input bg-background px-3 py-2 text-base transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className,
      )}
      {...props}
    />
  );
});

Textarea.displayName = "Textarea";

export { Textarea };
