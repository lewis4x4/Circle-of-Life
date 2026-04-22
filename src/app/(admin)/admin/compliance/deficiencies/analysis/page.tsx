"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  TrendingUp,
  Calendar,
  AlertTriangle,
  Filter,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import {
  getDeficiencyTrendByTag,
  getDeficiencyCountsByTag,
  getRecurringTags,
  getDeficiencySummary,
  type DeficiencyTrendPoint,
  type DeficiencyRecurrence,
} from "@/lib/deficiency-analysis";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { V2Card } from "@/components/ui/moonshot/v2-card";
const CHART_COLORS = {
  indigo: "#6366f1",
  rose: "#f43f5e",
  amber: "#f59e0b",
  emerald: "#10b981",
  grid: "rgba(255,255,255,0.05)",
  axis: "rgba(255,255,255,0.3)",
};

type TooltipPayloadEntry = {
  color?: string;
  name?: string;
  value?: number | string | null;
};

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/50 p-3 rounded-lg shadow-2xl">
        <p className="text-xs font-mono text-slate-400 mb-2 uppercase tracking-widest">{label}</p>
        {payload.map((p, idx) => (
          <div key={idx} className="flex items-center gap-2 mb-1 last:mb-0">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-sm font-semibold text-slate-100">
              {p.name}: <span className="font-mono">{p.value ?? 0}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export default function DeficienciesAnalysisPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();

  const [selectedMonths, setSelectedMonths] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [homeHref, setHomeHref] = useState("/admin");

  const [trendData, setTrendData] = useState<DeficiencyTrendPoint[]>([]);
  const [tagCounts, setTagCounts] = useState<{ tag_number: string; tag_title: string; count: number }[]>([]);
  const [recurringTags, setRecurringTags] = useState<DeficiencyRecurrence[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    bySeverity: Record<string, number>;
    byStatus: Record<string, number>;
    averageResolutionDays: number | null;
  } | null>(null);

  const loadData = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setTrendData([]);
      setTagCounts([]);
      setRecurringTags([]);
      setSummary(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [trend, counts, recurring, sum] = await Promise.all([
        getDeficiencyTrendByTag(selectedFacilityId, selectedMonths),
        getDeficiencyCountsByTag(selectedFacilityId, selectedMonths),
        getRecurringTags(selectedFacilityId, selectedMonths),
        getDeficiencySummary(selectedFacilityId, selectedMonths),
      ]);

      setTrendData(trend);
      setTagCounts(counts);
      setRecurringTags(recurring);
      setSummary(sum);
    } catch (e) {
      console.error("Failed to load deficiency analysis:", e);
      setError(e instanceof Error ? e.message : "Failed to load analysis data");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, selectedMonths]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setHomeHref("/admin");
        return;
      }
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("app_role")
        .eq("id", user.id)
        .maybeSingle();
      setHomeHref(profile?.app_role ? getDashboardRouteForRole(profile.app_role) : "/admin");
    })();
  }, [supabase]);

  const facilityReady = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  // Prepare trend data for line chart
  const trendChartData = trendData.map((point) => ({
    month: point.month,
    count: point.count,
    tag: point.tag_number,
  }));

  // Prepare bar chart data
  const barChartData = tagCounts.slice(0, 10).map((item) => ({
    tag: `Tag ${item.tag_number}`,
    title: item.tag_title,
    count: item.count,
  }));

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-12">
      <AmbientMatrix primaryClass="bg-indigo-500/10" />

      <div className="relative z-10 space-y-8 max-w-7xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between py-6">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 08 / Quality & Risk</p>
            <h1 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-indigo-500" />
              Deficiencies Analysis
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Historical deficiency trends, recurrence tracking, and gap analysis
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={homeHref} className="text-[10px] uppercase tracking-widest font-mono text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        {!facilityReady ? (
          <div className="rounded-[2rem] glass-panel bg-amber-50/40 dark:bg-amber-950/20 p-8 border border-amber-200/50 dark:border-amber-900/50 backdrop-blur-md">
            <h3 className="text-lg font-display font-semibold text-amber-900 dark:text-amber-300 mb-2">Select a facility</h3>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
              Choose a facility in header to load deficiency analysis.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[2rem] glass-panel bg-red-50/40 dark:bg-red-950/20 p-8 border border-red-200/50 dark:border-red-900/50 backdrop-blur-md">
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
          </div>
        ) : null}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-sm font-mono text-slate-500">Loading analysis data…</p>
          </div>
        ) : null}

        {!loading && facilityReady && (
          <>
            {/* Time Period Selector */}
            <div className="flex items-center gap-4 justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-slate-500" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Analysis Period</span>
              </div>
              <div className="flex gap-2">
                {[6, 12, 24].map((months) => (
                  <button
                    key={months}
                    onClick={() => setSelectedMonths(months)}
                    className={`px-4 py-2 rounded-lg text-sm font-mono transition-all ${
                      selectedMonths === months
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    {months} months
                  </button>
                ))}
              </div>
            </div>

            {/* Summary Statistics */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <V2Card className="p-4 text-center">
                  <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{summary.total}</p>
                  <p className="text-xs text-slate-500 uppercase mt-1">Total Deficiencies</p>
                </V2Card>
                <V2Card className="p-4 text-center">
                  <p className="text-3xl font-bold text-rose-600 dark:text-rose-400">
                    {(summary.bySeverity['serious'] || 0) + (summary.bySeverity['immediate_jeopardy'] || 0)}
                  </p>
                  <p className="text-xs text-slate-500 uppercase mt-1">Serious/Critical</p>
                </V2Card>
                <V2Card className="p-4 text-center">
                  <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                    {summary.averageResolutionDays ?? "—"}
                  </p>
                  <p className="text-xs text-slate-500 uppercase mt-1">Avg Resolution Days</p>
                </V2Card>
                <V2Card className="p-4 text-center">
                  <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                    {recurringTags.length}
                  </p>
                  <p className="text-xs text-slate-500 uppercase mt-1">Recurring Tags</p>
                </V2Card>
              </div>
            )}

            {/* Trend Chart */}
            {trendData.length > 0 && (
              <V2Card className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <TrendingUp className="h-5 w-5 text-indigo-500" />
                  <div>
                    <h2 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
                      Deficiency Trend Over Time
                    </h2>
                    <p className="text-sm text-slate-500">
                      Monthly deficiency counts by tag
                    </p>
                  </div>
                </div>
                <div style={{ height: 250 }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={trendChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.indigo} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={CHART_COLORS.indigo} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.grid} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px' }} />
                      <Area type="monotone" dataKey="count" stroke={CHART_COLORS.indigo} strokeWidth={2} fillOpacity={1} fill="url(#colorTrend)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </V2Card>
            )}

            {/* Most Cited Tags Chart */}
            {tagCounts.length > 0 && (
              <V2Card className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <AlertTriangle className="h-5 w-5 text-rose-500" />
                  <div>
                    <h2 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
                      Most Cited Tags
                    </h2>
                    <p className="text-sm text-slate-500">
                      Top {Math.min(10, tagCounts.length)} most frequently cited tags
                    </p>
                  </div>
                </div>
                <div style={{ height: 250 }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={barChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.grid} />
                      <XAxis dataKey="tag" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: CHART_COLORS.axis }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(244,63,94,0.05)' }} />
                      <Bar dataKey="count" fill={CHART_COLORS.rose} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </V2Card>
            )}

            {/* Recurring Tags Table */}
            {recurringTags.length > 0 ? (
              <V2Card className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <Filter className="h-5 w-5 text-amber-500" />
                  <div>
                    <h2 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
                      Recurring Tags Analysis
                    </h2>
                    <p className="text-sm text-slate-500">
                      Tags cited multiple times with gap analysis
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-left py-3 px-4 font-mono text-xs uppercase tracking-widest text-slate-500">Tag</th>
                        <th className="text-left py-3 px-4 font-mono text-xs uppercase tracking-widest text-slate-500">Title</th>
                        <th className="text-center py-3 px-4 font-mono text-xs uppercase tracking-widest text-slate-500">Occurrences</th>
                        <th className="text-center py-3 px-4 font-mono text-xs uppercase tracking-widest text-slate-500">Avg Gap (Days)</th>
                        <th className="text-center py-3 px-4 font-mono text-xs uppercase tracking-widest text-slate-500">Last Status</th>
                        <th className="text-center py-3 px-4 font-mono text-xs uppercase tracking-widest text-slate-500">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recurringTags.map((recurrence) => (
                        <tr key={recurrence.tag_number} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-3 px-4">
                            <Badge variant="outline" className="font-mono">
                              Tag {recurrence.tag_number}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{recurrence.tag_title}</td>
                          <td className="py-3 px-4 text-center font-mono font-bold text-slate-900 dark:text-slate-100">
                            {recurrence.total_occurrences}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {recurrence.days_between_average > 0 ? (
                              <span className="font-mono text-amber-600 dark:text-amber-400">
                                ~{recurrence.days_between_average} days
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Badge variant={
                              recurrence.occurrences[recurrence.occurrences.length - 1]?.status === 'verified'
                                ? 'default'
                                : recurrence.occurrences[recurrence.occurrences.length - 1]?.status === 'corrected'
                                ? 'secondary'
                                : 'destructive'
                            }>
                              {recurrence.occurrences[recurrence.occurrences.length - 1]?.status ?? 'unknown'}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Button variant="outline" size="sm" className="text-[10px] uppercase tracking-widest">
                              View Details
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </V2Card>
            ) : (
              <div className="rounded-2xl glass-panel bg-slate-50/40 dark:bg-slate-900/20 p-8 border border-slate-200/50 dark:border-slate-700/50 backdrop-blur-md text-center">
                <p className="font-medium text-slate-700 dark:text-slate-300">No recurring deficiencies</p>
                <p className="text-sm text-slate-500 mt-1">
                  Great job! No tags have been cited multiple times in the selected period.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
