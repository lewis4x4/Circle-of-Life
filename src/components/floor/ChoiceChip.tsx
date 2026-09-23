"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { FLOOR_FOCUS_RING, FLOOR_PRESS } from "./floor-styles";

/**
 * A 52 px chip that is on or off (DESIGN.md 05, 06). `aria-pressed` carries the
 * state; the selected look is the primary edge on the primary tint.
 */
export function ChoiceChip({
  pressed,
  onPress,
  children,
  disabled,
  className,
}: {
  pressed: boolean;
  onPress: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onPress}
      className={cn(
        "inline-flex h-13 items-center gap-2.5 rounded-[8px] border px-4.5 text-base disabled:cursor-not-allowed disabled:opacity-50",
        pressed ? "border-primary bg-primary/20 font-semibold text-foreground" : "border-input bg-card font-medium text-foreground hover:bg-muted",
        FLOOR_PRESS,
        FLOOR_FOCUS_RING,
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A labelled group of chips: "How is she? pick one". */
export function ChoiceGroup({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5" role="group" aria-labelledby={id}>
      <h2 id={id} className="text-[15px] font-semibold text-foreground">
        {title}
        <span className="font-normal text-muted-foreground"> {hint}</span>
      </h2>
      <div className="flex flex-wrap gap-2.5">{children}</div>
    </div>
  );
}
