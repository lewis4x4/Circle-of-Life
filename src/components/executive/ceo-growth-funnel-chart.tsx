"use client";

/**
 * Moonshot CEO Growth Funnel Chart
 *
 * Horizontal bar chart showing conversion pipeline from Web Inquiries to Move-Ins.
 * Features color coding, conversion rate labels, hover tooltips, and smooth transitions.
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
import { MOONSHOT_COLORS, type MoonshotColor } from "@/lib/moonshot-theme";

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
  /** Custom colors for stages (optional, defaults to preset) */
  stageColors?: Partial<Record<string, MoonshotColor>>;
  /** Show conversion rate labels */
  showConversionRates?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ── PRESET COLORS ──

const PRESET_STAGE_COLORS: Record<string, MoonshotColor> = {
  "Web Inquiries": "blue",
  "Phone Leads": "cyan",
  "Tours Scheduled": "purple",
  "Tours Completed": "purple",
  "Applications": "emerald",
  "Deposits": "gold",
  "Move-Ins": "emerald",
};

// ── CUSTOM TOOLTIP ──

type CustomTooltipProps = Partial<TooltipContentProps<number, string>>;

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload as GrowthFunnelDatum;
    return (
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/50 p-3 rounded-lg shadow-2xl">
        <p className="text-xs font-mono text-slate-400 mb-2 uppercase tracking-widest">
          {data.stage}
        </p>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: data.fill }} />
          <span className="text-sm font-semibold text-slate-100">
            Leads: <span className="font-mono">{data.count}</span>
          </span>
        </div>
        <div className="text-xs text-slate-400">
          Conversion: <span className="font-mono text-slate-200">{data.conversion.toFixed(1)}%</span>
        </div>
      </div>
    );
  }
  return null;
}

// ── MAIN COMPONENT ──

export function CeoGrowthFunnelChart({
  data,
  stageColors,
  showConversionRates = true,
  className,
}: CeoGrowthFunnelChartProps) {
  // Combine preset colors with custom colors
  const colors = { ...PRESET_STAGE_COLORS, ...stageColors };

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
            stroke={MOONSHOT_COLORS.border}
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
            tick={{ fontSize: 11, fill: MOONSHOT_COLORS.textDim }}
            axisLine={false}
            tickLine={false}
            width={130}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(56,189,248,0.05)' }} />
          <Bar
            dataKey="conversion"
            radius={[0, 4, 4, 0]}
            barSize={16}
          >
            {data.map((entry, index) => {
              const colorName = colors[entry.stage] || "slate";
              const colorHex = MOONSHOT_COLORS[colorName];
              return (
                <Cell
                  key={`cell-${index}`}
                  fill={colorHex}
                  fillOpacity={0.8}
                />
              );
            })}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── MOCK DATA GENERATOR ──

export function generateMockGrowthFunnelData(): GrowthFunnelDatum[] {
  return [
    { stage: "Web Inquiries", count: 342, conversion: 100, fill: MOONSHOT_COLORS.blue },
    { stage: "Phone Leads", count: 187, conversion: 54.7, fill: MOONSHOT_COLORS.cyan },
    { stage: "Tours Scheduled", count: 98, conversion: 28.7, fill: MOONSHOT_COLORS.purple },
    { stage: "Tours Completed", count: 76, conversion: 22.2, fill: MOONSHOT_COLORS.purple },
    { stage: "Applications", count: 41, conversion: 12.0, fill: MOONSHOT_COLORS.emerald },
    { stage: "Deposits", count: 29, conversion: 8.5, fill: MOONSHOT_COLORS.gold },
    { stage: "Move-Ins", count: 22, conversion: 6.4, fill: MOONSHOT_COLORS.emerald },
  ];
}

export default CeoGrowthFunnelChart;
