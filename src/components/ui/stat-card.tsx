"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * StatCard — Quiet Operator hub-page KPI tile primitive.
 *
 * Single source of truth for the lightweight "count of things" tiles that
 * sit at the top of every hub (e.g. "Active roster: 16", "Cert attention:
 * 3", "Open claims: 2"). Replaces inline `<div className="rounded-lg
 * border bg-card p-4 …">` blocks scattered across pages.
 *
 * Note: this is the LIGHTWEIGHT hub-page tile. The richer dashboard tile
 * (`<KPITile>` in `src/design-system/components/KPITile`) keeps its
 * sparkline + trend + breach UX and is used by the design-system T1/T4
 * templates. Use StatCard when you just want "label + number, with an
 * optional 0-guarded attention treatment."
 *
 * Binding rule (constitution rule 4 + anti-patterns.md):
 *   "Color carries clinical meaning … and must not be applied for
 *   aesthetic variety." A StatCard configured with `attentionTone` only
 *   renders that color treatment when there is actually attention to
 *   surface — that is, when the operator-facing count is > 0 (or
 *   `attentionWhen` is explicitly `true`). At rest, the card uses neutral
 *   chrome regardless of which `attentionTone` was declared.
 *
 * 0-value guard (binding):
 *   `<StatCard label="Cert attention" value={count} attentionTone="warning" />`
 *   When `count === 0` → neutral border, muted label, foreground value.
 *   When `count > 0`   → copper-tinted border + label + value (warning),
 *                       or red equivalent if `attentionTone="danger"`.
 *
 * Explicit override:
 *   `attentionWhen={someBoolean}` overrides the auto count > 0 inference
 *   for cases where attention is tied to a non-numeric signal (e.g. "any
 *   facility is breaching threshold").
 *
 * Typography:
 *   - Label: 11px uppercase tracking-wider, optional inline icon (size-3.5)
 *   - Value: 24px (text-2xl) semibold tabular-nums
 *
 * Usage:
 *
 *   <StatCard label="Active roster" value={16} icon={<UserRoundCheck />} />
 *
 *   <StatCard
 *     label="Cert attention"
 *     value={certRiskCount}
 *     attentionTone="warning"
 *     icon={<ShieldAlert />}
 *   />
 *
 *   <StatCard
 *     label="Open claims"
 *     value={openClaimsCount}
 *     attentionTone="danger"
 *   />
 */

export type StatCardAttentionTone = "warning" | "danger";

export type StatCardProps = {
  /** Caption-style label sitting above the value (11px uppercase). */
  label: string;
  /** The number / string the tile is reporting. */
  value: number | string;
  /** Optional inline icon — rendered at `size-3.5` inside the label row. */
  icon?: React.ReactNode;
  /**
   * If set, the card MAY render attention chrome (colored border / label /
   * value). Whether it actually does is gated by the 0-value guard — see
   * `attentionWhen` and the `value`-based inference rules below.
   *
   *   `"warning"` → amber (operator should look soon)
   *   `"danger"`  → red   (operator action required)
   */
  attentionTone?: StatCardAttentionTone;
  /**
   * Explicit override for the attention gate. When provided, this boolean
   * decides whether to apply `attentionTone` chrome.
   *
   * When omitted, the gate is inferred from `value`:
   *   - numeric `value` → applies attention when `value > 0`
   *   - string `value`  → applies attention always (the caller is
   *                       responsible for choosing whether to pass tone)
   */
  attentionWhen?: boolean;
  /** Optional sub-text rendered under the value (12px muted). */
  description?: React.ReactNode;
  className?: string;
};

function shouldApplyAttention(
  value: StatCardProps["value"],
  attentionWhen: boolean | undefined,
  attentionTone: StatCardAttentionTone | undefined,
): boolean {
  if (!attentionTone) return false;
  if (typeof attentionWhen === "boolean") return attentionWhen;
  if (typeof value === "number") return value > 0;
  return true;
}

const BORDER_BY_TONE: Record<StatCardAttentionTone, string> = {
  warning: "border-warning/30",
  danger: "border-destructive/30",
};

const LABEL_TEXT_BY_TONE: Record<StatCardAttentionTone, string> = {
  warning: "text-warning",
  danger: "text-destructive",
};

const VALUE_TEXT_BY_TONE: Record<StatCardAttentionTone, string> = {
  warning: "text-warning",
  danger: "text-destructive",
};

export function StatCard({
  label,
  value,
  icon,
  attentionTone,
  attentionWhen,
  description,
  className,
}: StatCardProps) {
  const isAttention = shouldApplyAttention(value, attentionWhen, attentionTone);
  const tone = isAttention ? attentionTone : undefined;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border bg-card p-4",
        tone ? BORDER_BY_TONE[tone] : "border-border",
        className,
      )}
      data-attention={isAttention ? "true" : "false"}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider",
          tone ? LABEL_TEXT_BY_TONE[tone] : "text-muted-foreground",
        )}
      >
        {icon ? (
          <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
        {label}
      </span>
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums tracking-tight",
          tone ? VALUE_TEXT_BY_TONE[tone] : "text-foreground",
        )}
      >
        {value}
      </span>
      {description ? (
        <span className="text-[12px] text-muted-foreground">{description}</span>
      ) : null}
    </div>
  );
}
