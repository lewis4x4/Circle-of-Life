"use client";

import { Check, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import type { CodeOption } from "@/lib/care-events/admin-copy";
import { cn } from "@/lib/utils";

/**
 * Chip rows for the completion form. Phone-first: 44 px targets, one row per
 * question, visible focus, and every chip is a real button with aria-pressed.
 * No default is ever selected; the value comes from the caller.
 */

const CHIP_BASE =
  "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] border px-3.5 py-2 text-sm font-medium transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";
const CHIP_IDLE = "border-[var(--border-strong)] bg-transparent text-foreground hover:bg-muted/40";
const CHIP_ON = "border-primary bg-primary/10 text-foreground";

export type ChoiceRowProps = {
  label: string;
  options: readonly CodeOption[];
  value: string | null;
  onChange: (code: string) => void;
  disabled?: boolean;
  busy?: boolean;
  /** A stamped line shown under the row once the choice is on file. */
  stamped?: string | null;
};

/** One-of chip row. */
export function ChoiceRow({ label, options, value, onChange, disabled, busy, stamped }: ChoiceRowProps) {
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = value === option.code;
          return (
            <button
              key={option.code}
              type="button"
              aria-pressed={on}
              disabled={disabled || busy}
              onClick={() => onChange(option.code)}
              className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_IDLE)}
            >
              {on ? <Check className="size-4" aria-hidden /> : null}
              {option.label}
            </button>
          );
        })}
        {busy ? <Loader2 className="size-4 animate-spin self-center text-muted-foreground" aria-label="Saving" /> : null}
      </div>
      {stamped ? <p className="text-xs text-muted-foreground">{stamped}</p> : null}
    </div>
  );
}

export type ChipRowProps = {
  label: string;
  options: readonly CodeOption[];
  values: readonly string[];
  onToggle: (code: string) => void;
  disabled?: boolean;
  busy?: boolean;
};

/** Many-of chip row. */
export function ChipRow({ label, options, values, onToggle, disabled, busy }: ChipRowProps) {
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = values.includes(option.code);
          return (
            <button
              key={option.code}
              type="button"
              aria-pressed={on}
              disabled={disabled || busy}
              onClick={() => onToggle(option.code)}
              className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_IDLE)}
            >
              {on ? <Check className="size-4" aria-hidden /> : null}
              {option.label}
            </button>
          );
        })}
        {busy ? <Loader2 className="size-4 animate-spin self-center text-muted-foreground" aria-label="Saving" /> : null}
      </div>
    </div>
  );
}

/** A labeled block with an optional stamped line and a slot for controls. */
export function SectionBlock({ label, stamped, children }: { label: string; stamped?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      <p className="text-sm font-medium text-foreground">{label}</p>
      {children}
      {stamped ? <p className="text-xs text-muted-foreground">{stamped}</p> : null}
    </div>
  );
}

export const chipClass = (on: boolean) => cn(CHIP_BASE, on ? CHIP_ON : CHIP_IDLE);
