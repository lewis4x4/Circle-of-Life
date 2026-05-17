"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * StatusPill — Quiet Operator status indicator.
 *
 * Binding rule (component-rules.md §Tables rule 3):
 *   "Status uses dot + label, never label alone."
 *
 * The dot is rendered by default. `showDot={false}` is a deliberate escape
 * hatch — use only when the surrounding cell already carries a status
 * indicator (e.g. a row-level color stripe).
 *
 * Decorative-color rule (anti-patterns.md):
 *   "Decorative use of color — color carries clinical meaning (red/amber/
 *   green) and must not be applied for aesthetic variety."
 *
 *   - Healthy / default / "nothing to do" values use `tone="neutral"`:
 *     muted gray dot, muted-foreground label, neutral pill chrome.
 *     (e.g. ACTIVE staff, CURRENT certs, LOW overtime risk, Acuity 1,
 *     In facility, On schedule.)
 *   - Color is reserved for exceptions that warrant operator attention:
 *     `tone="warning"`   amber (expiring cert, medium overtime risk, LOA)
 *     `tone="destructive"` red   (expired cert, high overtime, severity 4)
 *     `tone="info"`      steel-blue (informational, e.g. assisted ADL)
 *     `tone="success"`   green — RESERVED for "successfully resolved /
 *                              acknowledged" outcomes only, NOT for healthy
 *                              default state. (Use `neutral` for default.)
 *
 * Typography: 10px uppercase tracking-wider. Sits comfortably inside a 36px
 * Table / List row without lifting it.
 *
 * Usage:
 *   <StatusPill tone="neutral">Active</StatusPill>           // healthy/default
 *   <StatusPill tone="warning">Expiring soon</StatusPill>    // exception
 *   <StatusPill tone="destructive">Expired</StatusPill>      // exception
 *   <StatusPill tone="warning" pulsing>Syncing</StatusPill>  // transient
 *
 * Backward-compat `variant` prop maps onto the new `tone` API:
 *   variant="default"     → tone="neutral"
 *   variant="success"     → tone="success"
 *   variant="warning"     → tone="warning"
 *   variant="destructive" → tone="destructive"
 */

type Tone = "neutral" | "success" | "warning" | "destructive" | "info";

const dotVariants = cva("inline-block h-1.5 w-1.5 rounded-full shrink-0", {
  variants: {
    tone: {
      neutral: "bg-muted-foreground/60",
      success: "bg-success",
      warning: "bg-warning",
      destructive: "bg-destructive",
      info: "bg-info",
    } satisfies Record<Tone, string>,
    pulsing: {
      true: "animate-pulse",
      false: "",
    },
  },
  defaultVariants: {
    tone: "neutral",
    pulsing: false,
  },
});

const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors whitespace-nowrap",
  {
    variants: {
      tone: {
        // Healthy / default — no color, just neutral chrome + gray dot.
        neutral: "border-border bg-transparent text-muted-foreground",
        // Exceptions — soft tint chrome at /10 bg + /30 border (S8 policy).
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        destructive: "border-destructive/30 bg-destructive/10 text-destructive",
        info: "border-info/30 bg-info/10 text-info",
      } satisfies Record<Tone, string>,
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

type LegacyVariant = "default" | "success" | "warning" | "destructive";

const legacyVariantToTone: Record<LegacyVariant, Tone> = {
  default: "neutral",
  success: "success",
  warning: "warning",
  destructive: "destructive",
};

type StatusPillProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> &
  VariantProps<typeof pillVariants> & {
    /**
     * Backward-compat alias for `tone`. New code should pass `tone` directly.
     */
    variant?: LegacyVariant;
    /**
     * Default `true` — the dot is the convention (component-rules.md §Tables
     * rule 3). Pass `false` only when the surrounding cell already conveys
     * status visually (e.g. row-level color stripe).
     */
    dot?: boolean;
    pulsing?: boolean;
    children: React.ReactNode;
  };

export function StatusPill({
  tone,
  variant,
  dot = true,
  pulsing = false,
  className,
  children,
  ...props
}: StatusPillProps) {
  const resolvedTone: Tone = tone ?? (variant ? legacyVariantToTone[variant] : "neutral");

  return (
    <span className={cn(pillVariants({ tone: resolvedTone }), className)} {...props}>
      {dot && <span aria-hidden className={dotVariants({ tone: resolvedTone, pulsing })} />}
      {children}
    </span>
  );
}
