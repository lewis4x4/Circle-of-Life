"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchHousekeepingBrief, type HousekeeperDashboardBrief } from "@/lib/housekeeper/dashboard-brief";
import { BedDouble, CheckCircle2, AlertTriangle, Clock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export default function HousekeeperDashboardPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [brief, setBrief] = useState<HousekeeperDashboardBrief | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchHousekeepingBrief(selectedFacilityId);
      setBrief(data);
    } catch (e) {
      console.error("[housekeeper-dashboard]", e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => { void load(); }, [load]);

  if (isLoading) return <LoadingSkeleton />;

  if (!brief) return <ErrorState onRetry={load} />;

  const completionColor = brief.completionPct >= 80
    ? "text-emerald-400"
    : brief.completionPct >= 50
      ? "text-amber-400"
      : "text-rose-400";

  return (
    <div className="space-y-8 pb-12 px-4">
      {/* Header */}
      <div className="bg-white/5 dark:bg-white/[0.03] p-6 rounded-2xl border border-white/10 backdrop-blur-xl">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-[10px] font-bold uppercase tracking-widest text-violet-300 mb-3">
          <Sparkles className="w-3.5 h-3.5" /> Housekeeping
        </div>
        <h1 className="text-3xl font-display font-light tracking-tight text-white">
          My Dashboard
        </h1>
        <p className="text-zinc-400 font-medium tracking-wide mt-1 text-sm">
          Room assignments, priority cleans, and shift summary
        </p>
      </div>

      {/* Hero Stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <MobileStat title="Assigned" value={brief.roomsAssigned} icon={BedDouble} color="text-sky-400" />
        <MobileStat title="Completed" value={brief.roomsCompleted} icon={CheckCircle2} color="text-emerald-400" />
        <MobileStat title="Priority" value={brief.priorityCleans} icon={AlertTriangle} color={brief.priorityCleans > 0 ? "text-rose-400" : "text-zinc-400"} />
        <MobileStat title="Hours (Week)" value={brief.hoursThisWeek} icon={Clock} color="text-amber-400" />
      </div>

      {/* Completion Progress */}
      <div className="bg-white/5 dark:bg-white/[0.03] p-5 rounded-2xl border border-white/10 backdrop-blur-xl">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Completion</span>
          <span className={cn("text-2xl font-display font-medium tabular-nums", completionColor)}>
            {brief.completionPct}%
          </span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              brief.completionPct >= 80 ? "bg-emerald-500" : brief.completionPct >= 50 ? "bg-amber-500" : "bg-rose-500",
            )}
            style={{ width: `${Math.min(brief.completionPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Task List */}
      <div className="bg-white/5 dark:bg-white/[0.03] p-5 rounded-2xl border border-white/10 backdrop-blur-xl">
        <h3 className="text-lg font-display font-medium text-white mb-4 flex items-center gap-2">
          <BedDouble className="w-4 h-4 text-violet-400" /> Today&apos;s Rooms
        </h3>
        {brief.tasks.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-white/10 rounded-xl">
            <p className="text-sm font-medium text-zinc-500">No rooms assigned for today.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {brief.tasks.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "flex items-center justify-between p-3.5 rounded-xl border transition-all",
                  t.status === "completed"
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : t.isPriority
                      ? "bg-rose-500/5 border-rose-500/20"
                      : "bg-white/[0.03] border-white/5",
                )}
              >
                <div>
                  <span className="text-[14px] font-semibold text-white">
                    Room {t.roomNumber}
                  </span>
                  <span className="text-xs text-zinc-500 ml-2">{t.taskType}</span>
                </div>
                <div className="flex items-center gap-2">
                  {t.isPriority && (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400 px-2 py-0.5 rounded-full bg-rose-500/10">
                      Priority
                    </span>
                  )}
                  <span className={cn(
                    "text-xs font-medium",
                    t.status === "completed" ? "text-emerald-400" : "text-zinc-500",
                  )}>
                    {t.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MobileStat({ title, value, icon: Icon, color }: {
  title: string; value: string | number; icon: React.ElementType<{ className?: string }>; color: string;
}) {
  return (
    <div className="bg-white/5 dark:bg-white/[0.03] p-4 rounded-xl border border-white/10 backdrop-blur-xl">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{title}</span>
        <Icon className={cn("w-4 h-4", color)} />
      </div>
      <span className={cn("text-3xl font-display font-medium tabular-nums", color)}>{value}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 px-4 pt-2">
      <Skeleton className="h-28 w-full rounded-2xl bg-white/5" />
      <div className="grid gap-3 grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl bg-white/5" />)}
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-[60vh] items-center justify-center px-4">
      <div className="text-center">
        <p className="text-lg text-zinc-400 mb-4">Unable to load housekeeping dashboard.</p>
        <button onClick={onRetry} className="px-6 py-3 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700">Retry</button>
      </div>
    </div>
  );
}
