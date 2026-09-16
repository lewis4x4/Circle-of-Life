"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type TapButtonTone = "neutral" | "primary" | "selected" | "destructive";

export type TapButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: TapButtonTone;
  /** 56 px (`min-h-14`) is the floor; `tall` is 64 px for the one primary action. */
  tall?: boolean;
  children: ReactNode;
};

const TONE_CLASSES: Record<TapButtonTone, string> = {
  neutral: "border-border bg-card text-foreground hover:bg-muted/40",
  primary: "border-transparent bg-primary text-primary-foreground font-semibold hover:bg-primary/90",
  selected: "border-primary bg-primary/15 text-foreground font-semibold",
  destructive: "border-transparent bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90",
};

/**
 * Shared 56 px tap target for the "Something happened" flow (spec 07A §6.4).
 * Sentence case, no monospace, visible focus ring, reduced-motion safe.
 */
export function TapButton({ tone = "neutral", tall = false, className, type = "button", children, ...props }: TapButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "flex w-full items-center justify-center rounded-lg border px-4 py-3 text-left text-base leading-snug",
        "transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
        "disabled:cursor-not-allowed disabled:opacity-40",
        tall ? "min-h-16" : "min-h-14",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
