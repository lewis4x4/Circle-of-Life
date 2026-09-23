"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { FLOOR_FOCUS_RING, FLOOR_PRESS } from "./floor-styles";

/**
 * One large answer on a question screen (DESIGN.md 07): 76 px, 21/500, left
 * aligned. Single-answer questions are radios that move on when tapped;
 * multi-answer ones are toggles.
 */
export function QuestionOption({
  selected,
  multi,
  onPress,
  children,
}: {
  selected: boolean;
  multi: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={multi ? undefined : "radio"}
      aria-checked={multi ? undefined : selected}
      aria-pressed={multi ? selected : undefined}
      onClick={onPress}
      className={cn(
        "flex min-h-19 w-full items-center rounded-[12px] border px-6 py-3 text-left text-[21px] font-medium text-foreground",
        selected ? "border-primary bg-primary/20" : "border-input bg-card hover:bg-muted",
        FLOOR_PRESS,
        FLOOR_FOCUS_RING,
      )}
    >
      {children}
    </button>
  );
}
