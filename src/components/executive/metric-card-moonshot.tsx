"use client";

/**
 * Moonshot Metric Card
 *
 * Enhanced metric card component for executive dashboards.
 * Quiet Operator treatment: solid bg-card surface, semantic tokens,
 * 2px hover lift, no glass/blur/gradient chrome.
 */

import React from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { type MoonshotColor } from "@/lib/moonshot-theme";
import { MonoLabel, MetricValue } from "@/components/ui/typography";
// ── TYPES ──

export type TrendDirection = "up" | "down" | "flat";

export interface MetricCardMoonshotProps {
  /** Metric label text */
  label: string;
  /** Metric value to display */
  value: string | number;
  /** Moonshot color for styling */
  color: MoonshotColor;
  /** Trend direction (optional) */
  trend?: TrendDirection;
  /** Trend percentage change (optional) */
  trendValue?: string;
  /** Click handler for drill-down */
  onClick?: () => void;
  /** Link href for click-to-action */
  href?: string;
  /** Show sparkline in background */
  showSparkline?: boolean;
  /** Sparkline variant (1-4) */
  sparklineVariant?: number;
  /** Compact variant (smaller height) */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Disabled state (no click interaction) */
  disabled?: boolean;
}

// ── COMPONENT ──

export function MetricCardMoonshot({
  label,
  value,
  color,
  trend,
  trendValue,
  onClick,
  href,
  showSparkline = true,
  compact = false,
  className,
  disabled = false,
}: MetricCardMoonshotProps) {
  // Sparkline JSX was stripped during the Phase D D1 codemod sweep (the
  // `Sparkline` component was a null-return stub). `sparklineVariant` is no
  // longer referenced.

  const isInteractive = !disabled && (onClick || href);

  const content = (
    <div
      className={cn(
        "relative overflow-hidden transition-all duration-[var(--motion-duration)] ease-[var(--motion-ease)]",
        "rounded-[var(--radius)] p-[15px] h-[120px] flex flex-col justify-between",
        "bg-card text-card-foreground border border-border",
        "shadow-[var(--shadow-card)]",
        compact && "h-[100px] p-4",
        isInteractive &&
          "cursor-pointer hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      onClick={isInteractive ? onClick : undefined}
    >
      {/* Background Sparkline placeholder — no-op stub */}
      {showSparkline && (
        <div className="absolute bottom-0 left-0 right-0 h-20 pointer-events-none">
          <></>
        </div>
      )}

      {/* Top Section: Label and Trend */}
      <div className="relative z-10 flex items-center justify-between gap-2">
        <MonoLabel color={color}>{label}</MonoLabel>
        {trend && (
          <div
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
              trend === "up" && "bg-success/10 text-success",
              trend === "down" && "bg-destructive/10 text-destructive",
              trend === "flat" && "bg-muted text-muted-foreground"
            )}
          >
            {trend === "up" && (
              <TrendingUp className="w-3 h-3" />
            )}
            {trend === "down" && (
              <TrendingDown className="w-3 h-3" />
            )}
            {trend === "flat" && <Minus className="w-3 h-3" />}
            {trendValue && (
              <span>{trendValue}</span>
            )}
          </div>
        )}
      </div>

      {/* Bottom Section: Value */}
      <div className="relative z-10 flex items-end gap-2 pb-1">
        <MetricValue
          color={color}
          size={compact ? "2xl" : "3xl"}
          className="transition-all duration-[var(--motion-duration)]"
        >
          {value}
        </MetricValue>
        {isInteractive && (
          <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--motion-duration)]" />
        )}
      </div>
    </div>
  );

  // Wrap in Link if href is provided
  if (href && !disabled) {
    return (
      <Link href={href} className="block h-full w-full group outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-offset-2 rounded-[var(--radius)]">
        {content}
      </Link>
    );
  }

  return <div className="h-full w-full group">{content}</div>;
}

// ── VARIANT COMPONENTS ──

/**
 * Compact metric card variant for smaller spaces
 */
export type MetricCardCompactProps = Omit<MetricCardMoonshotProps, "compact">;

export function MetricCardCompact(props: MetricCardCompactProps) {
  return <MetricCardMoonshot {...props} compact />;
}

/**
 * Grid of metric cards
 */
export interface MetricCardGridProps {
  children: React.ReactNode;
  columns?: 1 | 2 | 3 | 4;
  gap?: "sm" | "md" | "lg";
  className?: string;
}

export function MetricCardGrid({
  children,
  columns = 4,
  gap = "md",
  className,
}: MetricCardGridProps) {
  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  };

  const gapSize = {
    sm: "gap-2",
    md: "gap-4",
    lg: "gap-6",
  };

  return (
    <div
      className={cn(
        "grid w-full",
        gridCols[columns],
        gapSize[gap],
        className
      )}
    >
      {children}
    </div>
  );
}

// ── EXPORTS ──

export default MetricCardMoonshot;
