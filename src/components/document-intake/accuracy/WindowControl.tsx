"use client";

import { useId } from "react";

import { ACCURACY_WINDOWS, type AccuracyWindow } from "@/lib/document-intake/jev-accuracy-report";
import { cn } from "@/lib/utils";

/**
 * Segmented choice of the approval window. Real radio inputs, so arrow keys
 * move between options and a screen reader announces "1 of 4"; the inputs are
 * visually hidden and the labels carry the look.
 */
export function WindowControl({ value, onChange, disabled }: { value: AccuracyWindow; onChange: (next: AccuracyWindow) => void; disabled?: boolean }) {
  const name = useId();
  return (
    <fieldset className="flex flex-wrap items-center gap-2" disabled={disabled}>
      <legend className="sr-only">Filed within</legend>
      <span aria-hidden className="text-xs text-muted-foreground">
        Filed within
      </span>
      <div className="inline-flex overflow-hidden rounded-md border border-border">
        {ACCURACY_WINDOWS.map((w, index) => {
          const id = `${name}-${w.key}`;
          const checked = value === w.key;
          return (
            <div key={w.key} className={cn("relative", index > 0 && "border-l border-border")}>
              <input id={id} type="radio" name={name} value={w.key} checked={checked} onChange={() => onChange(w.key)} className="peer sr-only" />
              <label
                htmlFor={id}
                className={cn(
                  "inline-flex min-h-11 cursor-pointer items-center px-3 text-sm peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-ring",
                  checked ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {w.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
