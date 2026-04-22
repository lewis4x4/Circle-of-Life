"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminAssistantDashboardBrief, type AdminAssistantDashboardBrief } from "@/lib/admin-assistant/dashboard-brief";
import { Users, FileText, MessageSquare, Truck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AssistantDashboardPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [brief, setBrief] = useState<AdminAssistantDashboardBrief | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchAdminAssistantDashboardBrief(selectedFacilityId);
      setBrief(data);
    } catch (e) {
      console.error("[assistant-dashboard]", e);
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
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-100/50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 text-[10px] font-bold uppercase tracking-widest text-sky-800 dark:text-sky-300 mb-2">
            <Zap className="w-3.5 h-3.5" /> Front Desk
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-light tracking-tight text-slate-900 dark:text-white">
            Admin Assistant Dashboard
          </h1>
          <p className="text-slate-600 dark:text-zinc-400 font-medium tracking-wide mt-2">
            Census, documents, messages, and daily operations overview
          </p>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Census" value={brief.censusCount} icon={Users} urgency="normal" subLabel="Active residents" href="/admin/residents" />
        <StatCard title="Pending Docs" value={brief.pendingDocs} icon={FileText} urgency={brief.pendingDocs > 0 ? "critical" : "normal"} subLabel={brief.pendingDocs > 0 ? "Awaiting action" : "All processed"} href="/admin/knowledge/admin" />
        <StatCard title="Unread Messages" value={brief.unreadMessages} icon={MessageSquare} urgency={brief.unreadMessages > 0 ? "critical" : "normal"} subLabel={brief.unreadMessages > 0 ? "Needs response" : "All read"} href="/admin/family-messages" />
        <StatCard title="Transport Today" value={brief.transportationToday} icon={Truck} urgency="normal" subLabel="Scheduled trips" href="/admin/transportation" />
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionTile label="Resident Directory" href="/admin/residents" gradient="bg-sky-500" />
        <ActionTile label="Family Messages" href="/admin/family-messages" gradient="bg-teal-500" />
        <ActionTile label="Staff Directory" href="/admin/staff" gradient="bg-indigo-500" />
        <ActionTile label="Transportation" href="/admin/transportation" gradient="bg-amber-500" />
      </div>

      {/* Messages Section */}
      <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
        <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-sky-500" /> Recent Messages
        </h3>
        {brief.recentMessages.length === 0 ? (
          <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-[1.5rem]">
            <p className="text-sm font-medium text-slate-500">No unread messages.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {brief.recentMessages.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-4 rounded-[1.5rem] bg-white border border-slate-100 dark:bg-white/[0.03] dark:border-white/5 shadow-sm">
                <div className="min-w-0">
                  <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{m.from}</span>
                  <span className="text-xs font-medium text-slate-500 dark:text-zinc-500 ml-2 truncate">{m.preview}</span>
                </div>
                <span className="text-xs font-medium text-slate-400 dark:text-zinc-500 shrink-0 ml-4">
                  {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        )}
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
        <p className="text-lg text-slate-600 dark:text-zinc-400 mb-4">Unable to load assistant dashboard.</p>
        <button onClick={onRetry} className="px-6 py-3 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700">Retry</button>
      </div>
    </div>
  );
}
