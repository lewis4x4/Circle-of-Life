"use client";

/**
 * Facility Drill-Down Modal
 *
 * Modal or slide-over panel for displaying facility-specific details
 * when clicking on executive metrics. Shows per-facility KPIs, trend charts,
 * active alerts, and click-to-action links to relevant modules.
 */

import React from "react";
import { X, Building2, TrendingUp, AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { type MoonshotColor } from "@/lib/moonshot-theme";

// ── TYPES ──

export interface FacilityMetric {
  label: string;
  value: string | number;
  color: MoonshotColor;
  trend?: "up" | "down" | "flat";
  trendValue?: string;
}

export interface FacilityAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  category: string;
  createdAt: string;
}

export interface FacilityDrillDownProps {
  /** Whether modal is open */
  isOpen: boolean;
  /** Callback when modal closes */
  onClose: () => void;
  /** Facility name */
  facilityName: string;
  /** Facility ID */
  facilityId: string;
  /** Facility-specific KPIs */
  metrics: FacilityMetric[];
  /** Active alerts for this facility */
  alerts?: FacilityAlert[];
  /** Optional trend chart data */
  trendData?: Array<{ date: string; value: number }>;
  /** Additional CSS classes */
  className?: string;
}

// ── MAIN COMPONENT ──

export function FacilityDrillDown({
  isOpen,
  onClose,
  facilityName,
  facilityId,
  metrics,
  alerts = [],
  trendData,
  className,
}: FacilityDrillDownProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className={cn(
            "bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col",
            className
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-100">
                  {facilityName}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {facilityId}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Metrics Grid */}
            <div>
              <h3 className="text-sm font-semibold text-slate-200 mb-3">
                Key Performance Indicators
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {metrics.map((metric, index) => (
                  <div
                    key={index}
                    className="bg-slate-800/50 border border-slate-700/30 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                        {metric.label}
                      </p>
                      {metric.trend && (
                        <div className="flex items-center gap-1">
                          {metric.trend === "up" && (
                            <TrendingUp className="w-3 h-3 text-emerald-400" />
                          )}
                          {metric.trendValue && (
                            <span className="text-[10px] font-mono text-slate-400">
                              {metric.trendValue}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <p
                      className={cn(
                        "text-2xl font-mono font-bold",
                        metric.color === "emerald" && "text-emerald-400",
                        metric.color === "purple" && "text-violet-400",
                        metric.color === "blue" && "text-sky-400",
                        metric.color === "rose" && "text-rose-400",
                        metric.color === "amber" && "text-amber-400",
                        metric.color === "cyan" && "text-cyan-400",
                        metric.color === "gold" && "text-amber-400",
                        metric.color === "slate" && "text-slate-200"
                      )}
                    >
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Active Alerts */}
            {alerts.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-200 mb-3">
                  Active Alerts
                </h3>
                <div className="space-y-2">
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="bg-slate-800/50 border border-slate-700/30 rounded-lg p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle
                              className={cn(
                                "w-3.5 h-3.5",
                                alert.severity === "critical" && "text-rose-400",
                                alert.severity === "warning" && "text-amber-400",
                                alert.severity === "info" && "text-blue-400"
                              )}
                            />
                            <span className="text-xs font-semibold text-slate-200">
                              {alert.title}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {alert.description}
                          </p>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 px-2 py-0.5 bg-slate-700/50 rounded">
                          {alert.category}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Trend Chart Placeholder */}
            {trendData && trendData.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-200 mb-3">
                  Trend Analysis
                </h3>
                <div className="bg-slate-800/50 border border-slate-700/30 rounded-xl p-4 h-48 flex items-center justify-center">
                  <p className="text-xs text-slate-400">
                    Trend chart rendering (component to be implemented)
                  </p>
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div>
              <h3 className="text-sm font-semibold text-slate-200 mb-3">
                Quick Actions
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <a
                  href={`/admin/incidents?facility=${facilityId}`}
                  className="flex items-center justify-between px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded-lg transition-colors group"
                >
                  <span className="text-sm font-medium text-slate-200">
                    View Incidents
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
                </a>
                <a
                  href={`/admin/compliance?facility=${facilityId}`}
                  className="flex items-center justify-between px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded-lg transition-colors group"
                >
                  <span className="text-sm font-medium text-slate-200">
                    View Compliance
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
                </a>
                <a
                  href={`/admin/billing?facility=${facilityId}`}
                  className="flex items-center justify-between px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded-lg transition-colors group"
                >
                  <span className="text-sm font-medium text-slate-200">
                    View Financials
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
                </a>
                <a
                  href={`/admin/staffing?facility=${facilityId}`}
                  className="flex items-center justify-between px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded-lg transition-colors group"
                >
                  <span className="text-sm font-medium text-slate-200">
                    View Staffing
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
                </a>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-700/50">
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 text-sm font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── MOCK DATA GENERATOR ──

export function generateMockFacilityDrillDownData(
  facilityName: string,
  facilityId: string
) {
  return {
    metrics: [
      {
        label: "Occupancy",
        value: "88.5%",
        color: "emerald" as MoonshotColor,
        trend: "up" as const,
        trendValue: "+3.2%",
      },
      {
        label: "Move-ins MTD",
        value: 12,
        color: "purple" as MoonshotColor,
        trend: "up" as const,
        trendValue: "+15.0%",
      },
      {
        label: "Critical Incidents",
        value: 2,
        color: "rose" as MoonshotColor,
        trend: "down" as const,
        trendValue: "-1",
      },
      {
        label: "Compliance Score",
        value: "94.2%",
        color: "blue" as MoonshotColor,
        trend: "up" as const,
        trendValue: "+1.8%",
      },
    ],
    alerts: [
      {
        id: "alert-1",
        severity: "critical" as const,
        title: "High Risk Incident Pattern",
        description: "3 falls with injury in the past 7 days, exceeding expected baseline.",
        category: "Safety",
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "alert-2",
        severity: "warning" as const,
        title: "Staffing Ratio Alert",
        description: "Staffing ratio below required minimum for night shift on 2 occasions.",
        category: "Workforce",
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    trendData: Array.from({ length: 12 }, (_, i) => ({
      date: new Date(Date.now() - (11 - i) * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      value: 85 + Math.random() * 10,
    })),
  };
}

export default FacilityDrillDown;
