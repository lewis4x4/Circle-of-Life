"use client";

/**
 * Moonshot CEO Growth Funnel Chart
 *
 * Horizontal bar chart showing conversion pipeline from Web Inquiries to Move-Ins.
 * Features conversion rate labels, hover tooltips, and smooth transitions.
 *
 * Quiet Operator treatment: solid bg-popover tooltip, semantic border,
 * chart-token bar colors (--chart-1…5), no glass/blur/gradient.
 *
 * Note: recharts tick.fill and CartesianGrid.stroke accept only resolved CSS
 * color strings (SVG attribute, not style prop). Values below are resolved
 * from globals.css tokens: --muted-foreground = 40 6% 55%,
 * --border = 36 6% 14%.
 *
 * MAINTENANCE: If globals.css chart tokens (--chart-1 … --chart-5),
 * --muted-foreground, --border, or --primary are retuned, update the
 * CHART_COLORS array and the inline `hsl()` / `hsla()` strings below.
 * SVG color attributes do not process `var()`, so manual sync is required.
 */

import React from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { cn } from "@/lib/utils";
import { type MoonshotColor } from "@/lib/moonshot-theme";

// ── TYPES ──

export interface GrowthFunnelDatum {
  stage: string;
  count: number;
  conversion: number;
  fill?: string;
}

export interface CeoGrowthFunnelChartProps {
  /** Data for the growth funnel */
  data: GrowthFunnelDatum[];
  /**
   * Custom colors for stages (legacy prop). Accepted for backward compat
   * but no longer drives Cell fills — Quiet Operator now cycles through
   * `--chart-1` … `--chart-5` for visual consistency across all charts.
   * Callers passing this prop will see their override silently ignored;
   * remove it when convenient.
   */
  stageColors?: Partial<Record<string, MoonshotColor>>;
  /** Show conversion rate labels */
  showConversionRates?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ── CHART COLORS — resolved from globals.css --chart-* tokens ──
// chart-1=205 27% 54%, chart-2=92 25% 49%, chart-3=32 58% 60%,
// chart-4=8 48% 54%, chart-5=204 26% 54%
const CHART_COLORS = [
  "hsl(205, 27%, 54%)",
  "hsl(92, 25%, 49%)",
  "hsl(32, 58%, 60%)",
  "hsl(8, 48%, 54%)",
  "hsl(204, 26%, 54%)",
];

// Resolved from --muted-foreground: 40 6% 55%
const AXIS_TICK_COLOR = "hsl(40, 6%, 55%)";
// Resolved from --border: 36 6% 14%
const GRID_STROKE_COLOR = "hsl(36, 6%, 14%)";

// ── CUSTOM TOOLTIP ──

type CustomTooltipProps = Partial<TooltipContentProps<number, string>>;

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload as GrowthFunnelDatum;
    return (
      <div className="bg-popover border border-border p-3 rounded-[var(--radius)] shadow-[var(--shadow-lift)]">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
          {data.stage}
        </p>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: data.fill }} />
          <span className="text-sm font-semibold text-foreground">
            Leads: <span>{data.count}</span>
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Conversion: <span className="text-foreground">{data.conversion.toFixed(1)}%</span>
        </div>
      </div>
    );
  }
  return null;
}

// ── MAIN COMPONENT ──

export function CeoGrowthFunnelChart({
  data,
  className,
}: CeoGrowthFunnelChartProps) {
  return (
    <div className={cn("w-full h-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={GRID_STROKE_COLOR}
            horizontal={true}
            vertical={false}
          />
          <XAxis
            type="number"
            hide
          />
          <YAxis
            type="category"
            dataKey="stage"
            tick={{ fontSize: 11, fill: AXIS_TICK_COLOR }}
            axisLine={false}
            tickLine={false}
            width={130}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsla(205, 27%, 54%, 0.05)" }} />
          <Bar
            dataKey="conversion"
            radius={[0, 4, 4, 0]}
            barSize={16}
          >
            {data.map((_entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default CeoGrowthFunnelChart;
