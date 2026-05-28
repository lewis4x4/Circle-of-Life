"use client";

import { useId } from "react";

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
const VIEWBOX_WIDTH = 96;
const VIEWBOX_HEIGHT = 32;
const PADDING = 2;

const toFixed = (value: number) => Number(value.toFixed(2));

export function Sparkline({
  data,
  tone = "default",
  ariaLabel,
  className,
}: SparklineProps) {
  const gradientBaseId = useId().replace(/:/g, "");
  const points = Array.isArray(data) ? data.filter(Number.isFinite) : [];
  const safe =
    points.length >= MIN_POINTS
      ? points
      : points.length === 1
        ? [points[0]!, points[0]!]
        : [];
  const color = TONE_TO_COLOR[tone];
  const gradientId = `${gradientBaseId}-${tone}`;

  const chartWidth = VIEWBOX_WIDTH - PADDING * 2;
  const chartHeight = VIEWBOX_HEIGHT - PADDING * 2;

  const minValue = safe.length ? Math.min(...safe) : 0;
  const maxValue = safe.length ? Math.max(...safe) : 0;
  const range = maxValue - minValue;

  const svgPoints = safe.map((value, index) => {
    const x =
      safe.length === 1
        ? VIEWBOX_WIDTH / 2
        : PADDING + (index / (safe.length - 1)) * chartWidth;
    const y =
      range === 0
        ? VIEWBOX_HEIGHT / 2
        : PADDING + ((maxValue - value) / range) * chartHeight;

    return { x: toFixed(x), y: toFixed(y) };
  });

  const linePath =
    svgPoints.length > 0
      ? svgPoints
          .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
          .join(" ")
      : "";

  const areaPath =
    svgPoints.length > 0
      ? `${linePath} L ${toFixed(PADDING + chartWidth)} ${toFixed(VIEWBOX_HEIGHT - PADDING)} L ${PADDING} ${toFixed(VIEWBOX_HEIGHT - PADDING)} Z`
      : "";

  return (
    <div
      role="img"
      aria-label={ariaLabel ?? "Sparkline trend chart"}
      data-tone={tone}
      className={cn("h-8 w-24 min-h-8 min-w-24", className)}
    >
      {safe.length === 0 ? (
        <span aria-hidden="true" className="block h-full w-full rounded-sm bg-surface-elevated" />
      ) : (
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          className="block h-full w-full"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} />
        </svg>
      )}
    </div>
  );
}
