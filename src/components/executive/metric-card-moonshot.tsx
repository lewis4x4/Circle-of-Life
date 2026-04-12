"use client";

/**
 * Moonshot Metric Card
 *
 * Enhanced metric card component for moonshot-quality executive dashboards.
 * Features neon glow borders, hover animations, sparkline area charts,
 * gradient fills, text shadows, and click-to-action support.
 */

import React from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { type MoonshotColor, getMoonshotColor, getMoonshotDimColor, createGlowShadow, createTextGlow } from "@/lib/moonshot-theme";
import { MonoLabel, MetricValue } from "@/components/ui/moonshot/typography";
import { Sparkline } from "@/components/ui/moonshot/sparkline";

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
  sparklineVariant = 1,
  compact = false,
  className,
  disabled = false,
}: MetricCardMoonshotProps) {
  const colorHex = getMoonshotColor(color);
  const dimColorHex = getMoonshotDimColor(color);
  const glowShadow = createGlowShadow(color);
  const textGlow = createTextGlow(color);

  const isInteractive = !disabled && (onClick || href);

  const content = (
    <div
      className={cn(
        "relative overflow-hidden transition-all duration-300",
        "rounded-2xl p-5 h-[120px] flex flex-col justify-between",
        "border border-white/5",
        "bg-[rgba(18, 25, 43, 0.5)] backdrop-blur-xl",
        compact && "h-[100px] p-4",
        isInteractive &&
          "cursor-pointer hover:-translate-y-[2px] hover:shadow-xl hover:border-white/10",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      style={{
        boxShadow: isInteractive ? glowShadow : undefined,
      }}
      onClick={isInteractive ? onClick : undefined}
    >
      {/* Background Sparkline */}
      {showSparkline && (
        <div className="absolute bottom-0 left-0 right-0 h-20 opacity-15 pointer-events-none">
          <Sparkline
            colorClass={`text-[${colorHex}]`}
            variant={sparklineVariant}
            className="opacity-100"
          />
        </div>
      )}

      {/* Top Section: Label and Trend */}
      <div className="relative z-10 flex items-center justify-between gap-2">
        <MonoLabel color={color}>{label}</MonoLabel>
        {trend && (
          <div className="flex items-center gap-1 text-[10px] font-semibold">
            {trend === "up" && (
              <TrendingUp className="w-3 h-3 text-emerald-400" />
            )}
            {trend === "down" && (
              <TrendingDown className="w-3 h-3 text-rose-400" />
            )}
            {trend === "flat" && <Minus className="w-3 h-3 text-slate-400" />}
            {trendValue && (
              <span
                className={cn(
                  "font-mono",
                  trend === "up" && "text-emerald-400",
                  trend === "down" && "text-rose-400",
                  trend === "flat" && "text-slate-400"
                )}
              >
                {trendValue}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom Section: Value */}
      <div className="relative z-10 flex items-end gap-2 pb-1">
        <MetricValue
          color={color}
          size={compact ? "2xl" : "3xl"}
          className="transition-all duration-300"
        >
          {value}
        </MetricValue>
        {isInteractive && (
          <ArrowUpRight className="w-4 h-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        )}
      </div>

      {/* Hover Glow Effect */}
      {isInteractive && (
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none mix-blend-screen"
          style={{
            background: `radial-gradient(circle at top, ${dimColorHex} 0%, transparent 70%)`,
          }}
        />
      )}
    </div>
  );

  // Wrap in Link if href is provided
  if (href && !disabled) {
    return (
      <Link href={href} className="block h-full w-full group outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-2xl">
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
export interface MetricCardCompactProps extends Omit<MetricCardMoonshotProps, "compact"> {}

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
