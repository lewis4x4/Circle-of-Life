"use client";

/**
 * Moonshot CEO Risk Index Chart
 *
 * Scatter/bar chart showing facilities on a risk matrix:
 * - X-axis: L3/L4 critical incidents
 * - Y-axis: Public reputation score (inverse)
 * - Quadrant analysis: High Risk, High Incidents, Poor Reputation, Safe Zone
 *
 * Quiet Operator treatment: solid bg-popover tooltip, semantic border,
 * semantic status colors for risk levels, no glass/blur.
 *
 * Note: recharts tick.fill and stroke props accept only resolved CSS color
 * strings (SVG attribute, not style prop). Values below are resolved from
 * globals.css tokens: --muted-foreground=40 6% 55%, --border=36 6% 14%,
 * --warning=32 58% 60%, --destructive=8 48% 54%, --success=92 25% 49%.
 *
 * MAINTENANCE: If globals.css --warning, --destructive, --success,
 * --muted-foreground, or --border are retuned, update RISK_COLORS and the
 * inline `hsla()` cursor fill below. SVG attributes do not process `var()`.
 */

import React from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { cn } from "@/lib/utils";
import { type MoonshotColor } from "@/lib/moonshot-theme";

// ── TYPES ──

export interface RiskIndexDatum {
  facility: string;
  criticalIncidents: number;
  reputationInverse: number;
  reputationScore?: number; // Actual reputation score (inverse of reputationInverse)
  facilityId?: string;
  color?: string;
}

export interface CeoRiskIndexChartProps {
  /** Data for the risk index */
  data: RiskIndexDatum[];
  /** Show quadrant reference lines */
  showQuadrants?: boolean;
  /** X-axis threshold for "high incidents" */
  highIncidentsThreshold?: number;
  /** Y-axis threshold for "poor reputation" */
  poorReputationThreshold?: number;
  /** Click handler for facility drill-down */
  onFacilityClick?: (facility: RiskIndexDatum) => void;
  /** Additional CSS classes */
  className?: string;
}

// ── RESOLVED SEMANTIC COLORS (from globals.css tokens) ──
// These match the --warning, --destructive, --success, --border, --muted-foreground values.
const RISK_COLORS: Record<string, string> = {
  rose: "hsl(8, 48%, 54%)",       // --destructive
  amber: "hsl(32, 58%, 60%)",      // --warning
  emerald: "hsl(92, 25%, 49%)",    // --success
};
const AXIS_TICK_COLOR = "hsl(40, 6%, 55%)";  // --muted-foreground
const GRID_STROKE_COLOR = "hsl(36, 6%, 14%)"; // --border
const REF_LINE_COLOR = "hsl(32, 58%, 60%)";   // --warning
const REF_AREA_COLOR = "hsl(8, 48%, 54%)";    // --destructive

function chartFacilityName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("facility" in payload)) {
    return null;
  }
  const facility = (payload as { facility?: unknown }).facility;
  return typeof facility === "string" ? facility : null;
}

// ── RISK LEVEL CALCULATOR ──

export function getRiskLevel(
  incidents: number,
  reputationInverse: number,
  highIncidentsThreshold: number = 5,
  poorReputationThreshold: number = 35
): { level: string; color: MoonshotColor } {
  const highIncidents = incidents >= highIncidentsThreshold;
  const poorReputation = reputationInverse <= poorReputationThreshold;

  if (highIncidents && poorReputation) {
    return { level: "High Risk", color: "rose" };
  }
  if (highIncidents) {
    return { level: "High Incidents", color: "amber" };
  }
  if (poorReputation) {
    return { level: "Poor Reputation", color: "amber" };
  }
  return { level: "Safe Zone", color: "emerald" };
}

// ── CUSTOM TOOLTIP ──

type CustomTooltipProps = Partial<TooltipContentProps<number, string>>;

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload as RiskIndexDatum;
    const riskLevel = getRiskLevel(data.criticalIncidents, data.reputationInverse);

    return (
      <div className="bg-popover border border-border p-3 rounded-[var(--radius)] shadow-[var(--shadow-lift)]">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
          {data.facility}
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: RISK_COLORS.rose }}
            />
            <span className="text-sm font-semibold text-foreground">
              L3/L4 Incidents: <span>{data.criticalIncidents}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: RISK_COLORS.amber }}
            />
            <span className="text-sm font-semibold text-foreground">
              Reputation: <span>{data.reputationScore || (50 - data.reputationInverse).toFixed(1)}</span>
            </span>
          </div>
          <div className="pt-1 border-t border-border mt-2">
            <span
              className={cn(
                "text-[11px] font-medium uppercase tracking-wider px-2 py-0.5 rounded",
                riskLevel.color === "emerald" && "bg-success/10 text-success",
                riskLevel.color === "amber" && "bg-warning/10 text-warning",
                riskLevel.color === "rose" && "bg-destructive/10 text-destructive"
              )}
            >
              {riskLevel.level}
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

// ── MAIN COMPONENT ──

export function CeoRiskIndexChart({
  data,
  showQuadrants = true,
  highIncidentsThreshold = 5,
  poorReputationThreshold = 35,
  onFacilityClick,
  className,
}: CeoRiskIndexChartProps) {
  // Enrich data with risk levels and semantic colors
  const enrichedData = React.useMemo(
    () =>
      data.map((item) => {
        const riskLevel = getRiskLevel(
          item.criticalIncidents,
          item.reputationInverse,
          highIncidentsThreshold,
          poorReputationThreshold
        );
        return {
          ...item,
          color: RISK_COLORS[riskLevel.color] || RISK_COLORS.amber,
        };
      }),
    [data, highIncidentsThreshold, poorReputationThreshold]
  );

  return (
    <div className={cn("w-full h-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={enrichedData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={GRID_STROKE_COLOR}
            vertical={false}
          />
          <XAxis
            dataKey="facility"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: AXIS_TICK_COLOR }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: AXIS_TICK_COLOR }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsla(8, 48%, 54%, 0.05)" }} />

          {/* Quadrant Reference Lines */}
          {showQuadrants && (
            <>
              <ReferenceLine
                y={poorReputationThreshold}
                stroke={REF_LINE_COLOR}
                strokeDasharray="5 5"
                strokeWidth={1}
                opacity={0.3}
              />
              <ReferenceLine
                x={highIncidentsThreshold}
                stroke={REF_LINE_COLOR}
                strokeDasharray="5 5"
                strokeWidth={1}
                opacity={0.3}
              />
            </>
          )}

          {/* High Risk Quadrant Highlight */}
          {showQuadrants && (
            <ReferenceArea
              x1={highIncidentsThreshold}
              x2={Infinity}
              y1={0}
              y2={poorReputationThreshold}
              fill={REF_AREA_COLOR}
              fillOpacity={0.05}
            />
          )}

          <Bar
            dataKey="criticalIncidents"
            radius={[4, 4, 0, 0]}
            barSize={40}
            cursor={onFacilityClick ? "pointer" : "default"}
            onClick={(data: unknown) => {
              if (onFacilityClick) {
                const facilityName = chartFacilityName(data);
                const facility = enrichedData.find(
                  (item) => item.facility === facilityName
                );
                if (facility) onFacilityClick(facility);
              }
            }}
          >
            {enrichedData.map((entry, index) => (
              <Cell
                key={`bar-${index}`}
                fill={entry.color}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default CeoRiskIndexChart;
