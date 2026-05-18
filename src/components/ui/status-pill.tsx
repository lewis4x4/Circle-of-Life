"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * StatusPill — Quiet Operator status indicator (dot + label).
 *
 * Binding rules:
 *   - component-rules.md §Tables rule 3 — "Status uses dot + label, never
 *     label alone." The dot is always rendered (default `dot={true}`); the
 *     escape hatch is `dot={false}` for transient cases.
 *   - anti-patterns.md "Decorative use of color" + constitution rule 3 —
 *     "One accent color. Semantic colors restrained." Healthy / default /
 *     "nothing to do" values render with tone `"muted"` (gray dot, muted
 *     label, neutral chrome). Color is reserved for genuine clinical /
 *     operational meaning.
 *
 * Tone API (single source of truth — all consumers should use these):
 *   - `tone="muted"`    (default) Healthy / default. Gray dot, muted label.
 *                       Acuity 1, In facility, On time, Posted, Approved (default
 *                       state), Independent, anything that is "nothing to
 *                       do here, just here for scan."
 *   - `tone="success"`  Green. Reserved for "successfully resolved /
 *                       acknowledged" outcomes — almost never appropriate
 *                       for a roster default state. Use sparingly.
 *   - `tone="warning"`  Amber. Operator attention soon — Expiring soon,
 *                       Medium overtime, Pending review, LOA, Overdue
 *                       (mild), Acuity 2.
 *   - `tone="danger"`   Red. Stop / blocked / harm — Expired, High
 *                       overtime, Severity 4, Acuity 3, Critical, Failed,
 *                       Hospital, Blocked, Suspended.
 *   - `tone="info"`     Steel-blue. Informational neutral state that
 *                       benefits from a slightly distinct color from muted —
 *                       Assisted ADL, FYI, Synced.
 *
 * Backward compatibility:
 *   The previous API used `tone="neutral" | "destructive"` and `variant=`.
 *   Both are mapped onto the new tone scale so consumers migrate via search
 *   + replace without breakage:
 *     tone="neutral"        → tone="muted"
 *     tone="destructive"    → tone="danger"
 *     variant="default"     → tone="muted"
 *     variant="success"     → tone="success"
 *     variant="warning"     → tone="warning"
 *     variant="destructive" → tone="danger"
 *
 * Usage:
 *   <StatusPill>Active</StatusPill>                     // muted default
 *   <StatusPill tone="warning">Expiring soon</StatusPill>
 *   <StatusPill tone="danger">Expired</StatusPill>
 *   <StatusPill tone="info" pulsing>Syncing</StatusPill>
 *
 * Typography: 10px sentence case. Sits inside a 36px table row.
 */

type Tone = "muted" | "success" | "warning" | "danger" | "info";

// Aliases accepted from older callers — map onto canonical Tone.
type ToneLegacy = "neutral" | "destructive";
type ToneInput = Tone | ToneLegacy;

const legacyToneMap: Record<ToneLegacy, Tone> = {
  neutral: "muted",
  destructive: "danger",
};

const resolveTone = (input: ToneInput | undefined, fallback: Tone): Tone => {
  if (!input) return fallback;
  if (input in legacyToneMap) return legacyToneMap[input as ToneLegacy];
  return input as Tone;
};

const dotVariants = cva("inline-block h-1.5 w-1.5 rounded-full shrink-0", {
  variants: {
    tone: {
      muted: "bg-muted-foreground/60",
      success: "bg-success",
      warning: "bg-warning",
      danger: "bg-destructive",
      info: "bg-info",
    } satisfies Record<Tone, string>,
    pulsing: {
      true: "animate-pulse",
      false: "",
    },
  },
  defaultVariants: {
    tone: "muted",
    pulsing: false,
  },
});

const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold normal-case tracking-tight transition-colors whitespace-nowrap",
  {
    variants: {
      tone: {
        // Default — no color, just neutral chrome + gray dot.
        muted: "border-border bg-transparent text-muted-foreground",
        // Colored — soft tint at /10 bg + /30 border (Quiet Operator policy).
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        danger: "border-destructive/30 bg-destructive/10 text-destructive",
        info: "border-info/30 bg-info/10 text-info",
      } satisfies Record<Tone, string>,
    },
    defaultVariants: {
      tone: "muted",
    },
  },
);

type LegacyVariant = "default" | "success" | "warning" | "destructive";
const legacyVariantToTone: Record<LegacyVariant, Tone> = {
  default: "muted",
  success: "success",
  warning: "warning",
  destructive: "danger",
};

type StatusPillProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> &
  Omit<VariantProps<typeof pillVariants>, "tone"> & {
    /**
     * Canonical tone API. Default `"muted"` per decorative-color rule.
     * Legacy `"neutral"` / `"destructive"` are accepted and remapped.
     */
    tone?: ToneInput;
    /** @deprecated Use `tone` directly. Mapped automatically for back-compat. */
    variant?: LegacyVariant;
    /**
     * Default `true` — the dot is the convention (component-rules.md
     * §Tables rule 3). Pass `false` only as a deliberate escape hatch.
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
  const resolvedTone: Tone = resolveTone(
    tone,
    variant ? legacyVariantToTone[variant] : "muted",
  );

  return (
    <span className={cn(pillVariants({ tone: resolvedTone }), className)} {...props}>
      {dot && <span aria-hidden className={dotVariants({ tone: resolvedTone, pulsing })} />}
      {children}
    </span>
  );
}

export type StatusPillTone = Tone;
