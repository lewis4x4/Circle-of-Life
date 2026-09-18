"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ObservationVocabOption } from "@/lib/rounding/observation-chips";

/**
 * One chip group on one line.
 *
 * This is the phone-first exception to the density rules: targets are 56px so
 * a caregiver holding a tablet in one hand hits what they aimed at. Nothing
 * else in the module sizes this way.
 */
export function ObservationChipRow({
  heading,
  options,
  selected,
  multiple = false,
  disabled = false,
  emptyLine,
  onToggle,
}: {
  heading: string;
  options: ObservationVocabOption[];
  selected: string[];
  multiple?: boolean;
  disabled?: boolean;
  emptyLine?: string;
  onToggle: (code: string) => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{heading}</h3>
      {options.length === 0 ? (
        <div className="space-y-1 text-sm">
          <p className="text-foreground">Nothing to tap here yet.</p>
          <p className="text-muted-foreground">{emptyLine ?? "These options appear once an administrator adds them for this building."}</p>
        </div>
      ) : (
        <div role={multiple ? "group" : "radiogroup"} aria-label={heading} className="flex flex-wrap gap-2">
          {options.map((option) => {
            const isSelected = selected.includes(option.code);
            return (
              <button
                key={option.code}
                type="button"
                disabled={disabled}
                role={multiple ? "checkbox" : "radio"}
                aria-checked={isSelected}
                onClick={() => onToggle(option.code)}
                className={cn(
                  "inline-flex min-h-[56px] items-center gap-2 rounded-[var(--radius)] border px-4 py-3 text-left text-base transition-colors",
                  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
                  isSelected
                    ? "border-[var(--border-strong)] bg-muted font-medium text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-[var(--border-strong)] hover:text-foreground",
                )}
              >
                {isSelected ? <Check className="h-4 w-4" aria-hidden /> : null}
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
