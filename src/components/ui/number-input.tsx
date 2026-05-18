"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Quiet Operator numeric field — styled ± steppers, no browser spinners. */
export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: number;
  onValueChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  function clamp(n: number) {
    let v = n;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  }

  const dec = step >= 1 ? () => onValueChange(clamp(value - step)) : () => onValueChange(clamp(Math.round(value - step)));
  const inc = step >= 1 ? () => onValueChange(clamp(value + step)) : () => onValueChange(clamp(Math.round(value + step)));

  return (
    <div
      className={cn(
        "inline-flex h-9 items-center overflow-hidden rounded-[var(--radius)] border border-[var(--border-strong)] bg-background",
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-8 shrink-0 rounded-none border-r border-border"
        disabled={disabled || (min != null && value <= min)}
        aria-label="Decrease value"
        onClick={dec}
      >
        <Minus className="size-3.5" aria-hidden />
      </Button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          "h-9 min-w-[3.25rem] flex-1 bg-transparent px-2 text-center text-sm font-medium tabular-nums text-foreground outline-none disabled:opacity-50",
        )}
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "" || raw === "-") return;
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onValueChange(clamp(n));
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-8 shrink-0 rounded-none border-l border-border"
        disabled={disabled || (max != null && value >= max)}
        aria-label="Increase value"
        onClick={inc}
      >
        <Plus className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
