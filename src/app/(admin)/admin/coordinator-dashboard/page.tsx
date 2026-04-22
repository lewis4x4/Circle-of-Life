"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchCoordinatorDashboardBrief, type CoordinatorDashboardBrief } from "@/lib/coordinator/dashboard-brief";
import { ClipboardList, FileCheck, MessageSquare, UserPlus, Activity, CalendarClock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export default function CoordinatorDashboardPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [brief, setBrief] = useState<CoordinatorDashboardBrief | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchCoordinatorDashboardBrief(selectedFacilityId);
      setBrief(data);
    } catch (e) {
      console.error("[coordinator-dashboard]", e);
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
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-100/50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-[10px] font-bold uppercase tracking-widest text-indigo-800 dark:text-indigo-300 mb-2">
            <Zap className="w-3.5 h-3.5" /> Resident Services
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-light tracking-tight text-slate-900 dark:text-white">
            Coordinator Dashboard
          </h1>
          <p className="text-slate-600 dark:text-zinc-400 font-medium tracking-wide mt-2">
            Care plans, assessments, family engagement, and admissions pipeline
          </p>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Care Plans" value={brief.activeCarePlans} icon={ClipboardList} urgency="normal" subLabel="Currently active" href="/admin/care-plans/reviews-due" />
        <StatCard title="Reviews Due (14d)" value={brief.reviewsDue14d} icon={CalendarClock} urgency={brief.reviewsDue14d > 0 ? "critical" : "normal"} subLabel={brief.reviewsDue14d > 0 ? "Attention needed" : "All current"} href="/admin/care-plans/reviews-due" />
        <StatCard title="Pending Assessments" value={brief.pendingAssessments} icon={FileCheck} urgency={brief.pendingAssessments > 0 ? "critical" : "normal"} subLabel={brief.pendingAssessments > 0 ? "Awaiting completion" : "None pending"} href="/admin/assessments/overdue" />
        <StatCard title="Family Messages" value={brief.unreadFamilyMessages} icon={MessageSquare} urgency={brief.unreadFamilyMessages > 0 ? "critical" : "normal"} subLabel={brief.unreadFamilyMessages > 0 ? "Unread messages" : "All read"} href="/admin/family-messages" />
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionTile label="Care Plans" href="/admin/care-plans/reviews-due" gradient="bg-indigo-500" />
        <ActionTile label="Assessments" href="/admin/assessments/overdue" gradient="bg-violet-500" />
        <ActionTile label="Family Messages" href="/admin/family-messages" gradient="bg-teal-500" />
        <ActionTile label="Admissions" href="/admin/admissions" gradient="bg-amber-500" />
      </div>

      {/* Bottom sections */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Care Plans Due */}
        <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-3">
            <CalendarClock className="w-5 h-5 text-amber-500" /> Care Plans Due for Review
          </h3>
          {brief.carePlansDue.length === 0 ? (
            <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-[1.5rem]">
              <p className="text-sm font-medium text-slate-500">No care plans due for review in the next 14 days.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brief.carePlansDue.map((cp) => (
                <div key={cp.id} className="flex items-center justify-between p-4 rounded-[1.5rem] bg-white border border-slate-100 dark:bg-white/[0.03] dark:border-white/5 shadow-sm">
                  <div>
                    <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{cp.residentName}</span>
                  </div>
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    {new Date(cp.reviewDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending Admissions */}
        <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-3">
            <UserPlus className="w-5 h-5 text-teal-500" /> Admission Pipeline
          </h3>
          {brief.pendingAdmissions.length === 0 ? (
            <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-[1.5rem]">
              <p className="text-sm font-medium text-slate-500">No pending admissions or inquiries.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brief.pendingAdmissions.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-4 rounded-[1.5rem] bg-white border border-slate-100 dark:bg-white/[0.03] dark:border-white/5 shadow-sm">
                  <div>
                    <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{a.name}</span>
                  </div>
                  <span className="text-xs font-medium text-teal-700 dark:text-teal-400">
                    {a.daysSinceInquiry}d since inquiry
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Secondary Stats Row */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="glass-panel rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-2xl p-6 shadow-sm flex items-center gap-4">
          <Activity className="w-5 h-5 text-rose-500" />
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400">Condition Changes (48h)</span>
            <p className="text-2xl font-display font-medium text-slate-900 dark:text-white tabular-nums">{brief.recentConditionChanges}</p>
          </div>
        </div>
        <div className="glass-panel rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-2xl p-6 shadow-sm flex items-center gap-4">
          <UserPlus className="w-5 h-5 text-indigo-500" />
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400">Active Admissions</span>
            <p className="text-2xl font-display font-medium text-slate-900 dark:text-white tabular-nums">{brief.activeAdmissions}</p>
          </div>
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
        <p className="text-lg text-slate-600 dark:text-zinc-400 mb-4">Unable to load coordinator dashboard.</p>
        <button onClick={onRetry} className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700">Retry</button>
      </div>
    </div>
  );
}
