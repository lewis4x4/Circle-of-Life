"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * StatusPill — small status indicator with optional colored dot.
 *
 * Used for transient operational state where the consumer wants to
 * surface "currently doing X" / "currently in Y" without a full Badge.
 * In the caregiver portal, this primitive backs the sync-state indicator
 * in the header (Synced / Syncing / Queued / Offline).
 *
 * Variants:
 *   - default    — neutral, `border-border text-muted-foreground`
 *   - success    — synced / online — green dot, neutral text
 *   - warning    — syncing / queued — amber dot
 *   - destructive — offline / failed — red dot
 *
 * The `dot` prop renders an inline 8×8 circle in the variant color,
 * optionally `pulsing` (CSS `animate-pulse`). The pill itself stays
 * neutral so consumers can stack multiple pills without color shouting.
 *
 * Variants use semantic tokens — `bg-success`, `bg-warning`, `bg-destructive`
 * — and resolve correctly in both light + dark.
 *
 * Usage:
 *   <StatusPill variant="success" dot>Synced</StatusPill>
 *   <StatusPill variant="warning" dot pulsing>Syncing</StatusPill>
 *   <StatusPill variant="destructive" dot>Offline · 3</StatusPill>
 *
 * Wrap externally with a `<button>` when the pill is clickable. The
 * primitive is a `<span>` by default — it does not assume interaction.
 */

const dotVariants = cva("inline-block h-2 w-2 rounded-full", {
  variants: {
    variant: {
      default: "bg-muted-foreground",
      success: "bg-success",
      warning: "bg-warning",
      destructive: "bg-destructive",
    },
    pulsing: {
      true: "animate-pulse",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    pulsing: false,
  },
});

const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-background text-muted-foreground",
        success: "border-success/30 bg-success/10 text-foreground",
        warning: "border-warning/30 bg-warning/10 text-foreground",
        destructive: "border-destructive/30 bg-destructive/10 text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type StatusPillProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof pillVariants> & {
    dot?: boolean;
    pulsing?: boolean;
    children: React.ReactNode;
  };

export function StatusPill({
  variant,
  dot = false,
  pulsing = false,
  className,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span className={cn(pillVariants({ variant }), className)} {...props}>
      {dot && <span aria-hidden className={dotVariants({ variant, pulsing })} />}
      {children}
    </span>
  );
}
