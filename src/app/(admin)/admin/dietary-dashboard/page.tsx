"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchDietaryDashboardBrief, type DietaryDashboardBrief } from "@/lib/dietary/dashboard-brief";
import { Utensils, Salad, Clock, AlertCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export default function DietaryDashboardPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [brief, setBrief] = useState<DietaryDashboardBrief | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchDietaryDashboardBrief(selectedFacilityId);
      setBrief(data);
    } catch (e) {
      console.error("[dietary-dashboard]", e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => { void load(); }, [load]);

  if (isLoading) return <LoadingSkeleton />;

  if (!brief) return <ErrorState onRetry={load} />;

  return (
    <div className="space-y-10 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100/50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-[10px] font-bold uppercase tracking-widest text-emerald-800 dark:text-emerald-300 mb-2">
            <Zap className="w-3.5 h-3.5" /> Kitchen Operations
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-light tracking-tight text-slate-900 dark:text-white">
            Dietary Dashboard
          </h1>
          <p className="text-slate-600 dark:text-zinc-400 font-medium tracking-wide mt-2">
            Meal service, dietary restrictions, and kitchen operations
          </p>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Census" value={brief.censusCount} icon={Utensils} urgency="normal" subLabel="Active residents" href="/admin/residents" />
        <StatCard title="Special Diets" value={brief.specialDiets} icon={Salad} urgency="normal" subLabel="Active diet orders" href="/admin/dietary" />
        <StatCard title="Meals Today" value={brief.mealsToday} icon={Clock} urgency="normal" subLabel="Served today" href="/admin/dietary" />
        <StatCard title="Diet Changes (48h)" value={brief.dietChanges48h} icon={AlertCircle} urgency={brief.dietChanges48h > 0 ? "critical" : "normal"} subLabel={brief.dietChanges48h > 0 ? "Recent changes" : "No changes"} href="/admin/dietary" />
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionTile label="Today's Menu" href="/admin/dietary" gradient="bg-emerald-500" />
        <ActionTile label="Diet Restrictions" href="/admin/dietary" gradient="bg-rose-500" />
        <ActionTile label="Meal Service Log" href="/admin/dietary" gradient="bg-amber-500" />
        <ActionTile label="Clinical Review" href="/admin/dietary/clinical-review" gradient="bg-violet-500" />
      </div>

      {/* Bottom sections */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Diet Type Breakdown */}
        <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-3">
            <Salad className="w-5 h-5 text-emerald-500" /> Active Diet Types
          </h3>
          {brief.specialDietBreakdown.length === 0 ? (
            <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-[1.5rem]">
              <p className="text-sm font-medium text-slate-500">No active diet orders on file.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brief.specialDietBreakdown.map((d) => (
                <div key={d.dietType} className="flex items-center justify-between p-4 rounded-[1.5rem] bg-white border border-slate-100 dark:bg-white/[0.03] dark:border-white/5 shadow-sm">
                  <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{d.dietType}</span>
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Diet Changes */}
        <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500" /> Recent Diet Changes
          </h3>
          {brief.recentDietChanges.length === 0 ? (
            <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-[1.5rem]">
              <p className="text-sm font-medium text-slate-500">No diet changes in the last 48 hours.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brief.recentDietChanges.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-4 rounded-[1.5rem] bg-white border border-slate-100 dark:bg-white/[0.03] dark:border-white/5 shadow-sm">
                  <div>
                    <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{c.residentName}</span>
                    <span className="text-xs font-medium text-slate-500 dark:text-zinc-500 ml-2">{c.changeType}</span>
                  </div>
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    {new Date(c.changedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, urgency, subLabel, href }: {
  title: string; value: string | number; icon: React.ElementType<{ className?: string }>; urgency: "critical" | "normal"; subLabel: string; href: string;
}) {
  const bg = urgency === "critical" ? "bg-rose-50/80 dark:bg-rose-950/20 border-rose-200 dark:border-rose-500/30" : "bg-white/60 dark:bg-white/[0.02] border-slate-200 dark:border-white/5";
  const text = urgency === "critical" ? "text-rose-700 dark:text-rose-400" : "text-slate-800 dark:text-zinc-200";

  return (
    <Link href={href} className="block group">
      <div className={cn("rounded-[2rem] p-6 lg:p-8 border backdrop-blur-2xl transition-all hover:shadow-lg min-h-[160px] flex flex-col justify-between", bg)}>
        <div className="flex items-start justify-between">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400">{title}</span>
          <Icon className="w-5 h-5 text-slate-400" />
        </div>
        <div>
          <span className={cn("text-5xl font-display font-medium tabular-nums tracking-tight", text)}>{value}</span>
          <p className="text-xs font-semibold text-slate-600/80 dark:text-zinc-500 mt-1">{subLabel}</p>
        </div>
      </div>
    </Link>
  );
}

function ActionTile({ label, href, gradient }: { label: string; href: string; gradient: string }) {
  return (
    <Link href={href} className="block group">
      <div className={cn("rounded-[1.5rem] p-5 text-white font-semibold tracking-wide flex items-center justify-center transition-all hover:shadow-lg hover:scale-[1.02] text-sm", gradient)}>
        {label}
      </div>
    </Link>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8 pt-2">
      <Skeleton className="h-32 w-full rounded-[2.5rem] bg-slate-200 dark:bg-white/5" />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-[2rem] bg-slate-200 dark:bg-white/5" />)}
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="text-center">
        <p className="text-lg text-slate-600 dark:text-zinc-400 mb-4">Unable to load dietary dashboard.</p>
        <button onClick={onRetry} className="px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700">Retry</button>
      </div>
    </div>
  );
}
