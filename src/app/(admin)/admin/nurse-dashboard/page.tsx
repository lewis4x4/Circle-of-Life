"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchNurseMedicationBrief, type NurseMedicationBrief } from "@/lib/nurse/medication-brief";
import { createClient } from "@/lib/supabase/client";
import { Pill, ShieldCheck, AlertTriangle, Activity, Clock, FileWarning, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export default function NurseDashboardPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [brief, setBrief] = useState<NurseMedicationBrief | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchNurseMedicationBrief(selectedFacilityId);
      setBrief(data);
    } catch (e) {
      console.error("[nurse-dashboard]", e);
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
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-100/50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/20 text-[10px] font-bold uppercase tracking-widest text-teal-800 dark:text-teal-300 mb-2">
            <Zap className="w-3.5 h-3.5" /> Medication Manager
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-light tracking-tight text-slate-900 dark:text-white">
            Medication Dashboard
          </h1>
          <p className="text-slate-600 dark:text-zinc-400 font-medium tracking-wide mt-2">
            eMAR compliance, controlled substances, and clinical oversight
          </p>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Medications" value={brief.activeMedications} icon={Pill} urgency="normal" subLabel="Currently prescribed" href="/admin/residents" />
        <StatCard title="eMAR Compliance" value={`${brief.emarCompliancePct}%`} icon={Activity} urgency={brief.emarCompliancePct < 95 ? "critical" : "normal"} subLabel={brief.emarCompliancePct < 95 ? "Below 95% threshold" : "On target"} href="/med-tech" />
        <StatCard title="Med Errors (7d)" value={brief.medErrors7d} icon={AlertTriangle} urgency={brief.medErrors7d > 0 ? "critical" : "normal"} subLabel={brief.medErrors7d > 0 ? "Requires review" : "None reported"} href="/admin/medications/errors?review=unreviewed" />
        <StatCard title="Controlled Counts" value={brief.controlledDiscrepancies} icon={ShieldCheck} urgency={brief.controlledDiscrepancies > 0 ? "critical" : "normal"} subLabel={brief.controlledDiscrepancies > 0 ? "Discrepancies found" : "All verified"} href="/med-tech/controlled-count" />
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionTile label="Open Med Pass" href="/med-tech" gradient="bg-teal-500" />
        <ActionTile label="Controlled Counts" href="/med-tech/controlled-count" gradient="bg-rose-500" />
        <ActionTile label="Med Error Review" href="/admin/medications/errors?review=unreviewed" gradient="bg-amber-500" />
        <ActionTile label="Report Incident" href="/admin/incidents/new" gradient="bg-indigo-500" />
      </div>

      {/* Bottom sections */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Missed Doses */}
        <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-3">
            <FileWarning className="w-5 h-5 text-amber-500" /> Dose Alerts Today
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center bg-white dark:bg-black/40 p-5 rounded-[1.5rem] border border-slate-100 dark:border-white/5">
              <span className="text-[13px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Missed / Held Doses</span>
              <span className="text-2xl font-display font-medium text-amber-600 dark:text-amber-400 tabular-nums">{brief.missedDosesToday}</span>
            </div>
            <div className="flex justify-between items-center bg-white dark:bg-black/40 p-5 rounded-[1.5rem] border border-slate-100 dark:border-white/5">
              <span className="text-[13px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">PRN Given (24h)</span>
              <span className="text-2xl font-display font-medium text-slate-900 dark:text-white tabular-nums">{brief.prnGiven24h}</span>
            </div>
          </div>
        </div>

        {/* Clinical Watchlist */}
        <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-3">
            <Activity className="w-5 h-5 text-rose-500" /> Clinical Watchlist
          </h3>
          {brief.watchlistResidents.length === 0 ? (
            <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-[1.5rem]">
              <p className="text-sm font-medium text-slate-500">No residents flagged for medication review.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brief.watchlistResidents.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-4 rounded-[1.5rem] bg-white border border-slate-100 dark:bg-white/[0.03] dark:border-white/5 shadow-sm">
                  <div>
                    <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{r.name}</span>
                    <span className="text-xs font-medium text-slate-500 dark:text-zinc-500 ml-2">Room {r.room}</span>
                  </div>
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{r.reason}</span>
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
        <p className="text-lg text-slate-600 dark:text-zinc-400 mb-4">Unable to load medication dashboard.</p>
        <button onClick={onRetry} className="px-6 py-3 rounded-xl bg-teal-600 text-white font-semibold hover:bg-teal-700">Retry</button>
      </div>
    </div>
  );
}
