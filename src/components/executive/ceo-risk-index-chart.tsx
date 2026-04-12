"use client";

/**
 * Moonshot CEO Risk Index Chart
 *
 * Scatter/bar chart showing facilities on a risk matrix:
 * - X-axis: L3/L4 critical incidents
 * - Y-axis: Public reputation score (inverse)
 * - Quadrant analysis: High Risk, High Incidents, Poor Reputation, Safe Zone
 */

import React from "react";
import {
  BarChart,
  Bar,
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
import { MOONSHOT_COLORS, type MoonshotColor } from "@/lib/moonshot-theme";

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

interface CustomTooltipProps extends TooltipContentProps<number, string> {}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload as RiskIndexDatum;
    const riskLevel = getRiskLevel(data.criticalIncidents, data.reputationInverse);

    return (
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/50 p-3 rounded-lg shadow-2xl">
        <p className="text-xs font-mono text-slate-400 mb-2 uppercase tracking-widest">
          {data.facility}
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: MOONSHOT_COLORS.rose }}
            />
            <span className="text-sm font-semibold text-slate-100">
              L3/L4 Incidents: <span className="font-mono">{data.criticalIncidents}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: MOONSHOT_COLORS.amber }}
            />
            <span className="text-sm font-semibold text-slate-100">
              Reputation: <span className="font-mono">{data.reputationScore || (50 - data.reputationInverse).toFixed(1)}</span>
            </span>
          </div>
          <div className="pt-1 border-t border-slate-700 mt-2">
            <span
              className={cn(
                "text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded",
                riskLevel.color === "emerald" && "bg-emerald-500/20 text-emerald-300",
                riskLevel.color === "amber" && "bg-amber-500/20 text-amber-300",
                riskLevel.color === "rose" && "bg-rose-500/20 text-rose-300"
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
  // Enrich data with risk levels and colors
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
          color: MOONSHOT_COLORS[riskLevel.color],
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
            stroke={MOONSHOT_COLORS.border}
            vertical={false}
          />
          <XAxis
            dataKey="facility"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: MOONSHOT_COLORS.textDim }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: MOONSHOT_COLORS.textDim }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(244,63,94,0.05)" }} />

          {/* Quadrant Reference Lines */}
          {showQuadrants && (
            <>
              <ReferenceLine
                y={poorReputationThreshold}
                stroke={MOONSHOT_COLORS.amber}
                strokeDasharray="5 5"
                strokeWidth={1}
                opacity={0.3}
              />
              <ReferenceLine
                x={highIncidentsThreshold}
                stroke={MOONSHOT_COLORS.amber}
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
              fill={MOONSHOT_COLORS.rose}
              fillOpacity={0.05}
            />
          )}

          <Bar
            dataKey="criticalIncidents"
            radius={[4, 4, 0, 0]}
            barSize={40}
            cursor={onFacilityClick ? "pointer" : "default"}
            onClick={(data) => {
              if (onFacilityClick) {
                const facility = enrichedData.find(
                  (item) => item.facility === data.facility
                );
                if (facility) onFacilityClick(facility);
              }
            }}
          >
            {enrichedData.map((entry, index) => (
              <div
                key={`bar-${index}`}
                style={{ fill: entry.color }}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── MOCK DATA GENERATOR ──

export function generateMockRiskIndexData(): RiskIndexDatum[] {
  return [
    {
      facility: "Grande Cypress",
      criticalIncidents: 1,
      reputationInverse: 48,
      reputationScore: 49.0,
      facilityId: "fac-001",
    },
    {
      facility: "Homewood Lodge",
      criticalIncidents: 4,
      reputationInverse: 39,
      reputationScore: 42.5,
      facilityId: "fac-002",
    },
    {
      facility: "Oakridge",
      criticalIncidents: 12,
      reputationInverse: 25,
      reputationScore: 35.5,
      facilityId: "fac-003",
    },
    {
      facility: "Plantation",
      criticalIncidents: 0,
      reputationInverse: 49,
      reputationScore: 49.5,
      facilityId: "fac-004",
    },
    {
      facility: "Rising Oaks",
      criticalIncidents: 2,
      reputationInverse: 45,
      reputationScore: 46.0,
      facilityId: "fac-005",
    },
  ];
}

export default CeoRiskIndexChart;
