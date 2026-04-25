"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { tokens } from "@/design-system/tokens";
import { cn } from "@/lib/utils";

export type SparklineTone =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "regulatory";

export type SparklineProps = {
  data: number[];
  tone?: SparklineTone;
  ariaLabel?: string;
  className?: string;
};

const TONE_TO_COLOR: Record<SparklineTone, string> = {
  default: tokens.color.text.secondary,
  success: tokens.color.semantic.success,
  warning: tokens.color.semantic.warning,
  danger: tokens.color.semantic.danger,
  info: tokens.color.semantic.info,
  regulatory: tokens.color.semantic.regulatory,
};

const MIN_POINTS = 2;

export function Sparkline({
  data,
  tone = "default",
  ariaLabel,
  className,
}: SparklineProps) {
  const points = Array.isArray(data) ? data : [];
  const safe =
    points.length >= MIN_POINTS
      ? points
      : points.length === 1
        ? [points[0]!, points[0]!]
        : [];
  const series = safe.map((value, index) => ({ x: index, value }));
  const color = TONE_TO_COLOR[tone];
  const gradientId = `sparkline-${tone}`;

  return (
    <div
      role="img"
      aria-label={ariaLabel ?? "Sparkline trend chart"}
      data-tone={tone}
      className={cn("h-8 w-24 min-h-8 min-w-24", className)}
    >
      {series.length === 0 ? (
        <span aria-hidden="true" className="block h-full w-full rounded-sm bg-surface-elevated" />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
