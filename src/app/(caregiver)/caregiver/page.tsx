"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Loader2,
  LogIn,
  MessageSquare,
  Pill,
  UserRound,
  Waves,
  ChevronRight,
  ShieldAlert,
  Activity
} from "lucide-react";

import { fetchCaregiverShiftBrief, type CaregiverShiftBrief } from "@/lib/caregiver/shift-brief";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

export default function CaregiverHomePage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setFacilityName] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState("America/New_York");
  const [brief, setBrief] = useState<CaregiverShiftBrief | null>(null);
  const [activeOutbreak, setActiveOutbreak] = useState<{ id: string; infection_type: string } | null>(null);
  const [myOutbreakActions, setMyOutbreakActions] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }
    try {
      const resolved = await loadCaregiverFacilityContext(supabase);
      if (!resolved.ok) {
        setLoadError(resolved.error);
        setLoading(false);
        return;
      }
      const { ctx } = resolved;
      setFacilityName(ctx.facilityName);
      setTimeZone(ctx.timeZone);
      const b = await fetchCaregiverShiftBrief(supabase, ctx);
      setBrief(b);
      const ob = await supabase
        .from("infection_outbreaks")
        .select("id, infection_type")
        .eq("facility_id", ctx.facilityId)
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      const first = ob.data as { id: string; infection_type: string } | null;
      setActiveOutbreak(first);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && first) {
        const cnt = await supabase
          .from("outbreak_actions")
          .select("id", { count: "exact", head: true })
          .eq("outbreak_id", first.id)
          .eq("assigned_to", user.id)
          .in("status", ["pending", "in_progress"]);
        setMyOutbreakActions(cnt.count ?? 0);
      } else {
        setMyOutbreakActions(0);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load shift brief.");
      setBrief(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const shiftLine = useMemo(() => {
    const shift = currentShiftForTimezone(timeZone);
    const ymd = zonedYmd(new Date(), timeZone);
    return `${ymd} · ${shift} shift`;
  }, [timeZone]);

  if (configError) {
    return (
      <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 px-6 py-4 text-sm text-rose-100 backdrop-blur-md">
        {configError}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-zinc-400">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
        <p className="text-sm font-medium tracking-wide uppercase">Initializing Shift Dashboard…</p>
      </div>
    );
  }

  if (loadError || !brief) {
    return (
      <div className="space-y-4 max-w-md mx-auto mt-12">
        <div className="rounded-xl glass-card border-rose-800/60 bg-rose-950/30 px-6 py-5 text-sm text-rose-100 text-center">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-rose-400" />
          <p>{loadError ?? "Shift brief unavailable."}</p>
        </div>
        <button
          type="button"
          className="w-full h-12 rounded-xl bg-white/10 border border-white/20 text-sm font-semibold text-white hover:bg-white/20 transition-colors"
          onClick={() => void load()}
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const docPending = brief.openConditionCount + brief.pendingPrnCount;
  const emarWindow = brief.emarDueNow + brief.emarDueSoon;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 max-w-[1400px] mx-auto pb-6">
      
      {/* ─── ROW 1: MISSION CONTROL OVERVIEW ─────────────────────────────────── */}
      <div className="glass-panel rounded-[2rem] md:col-span-full p-6 md:p-8 relative overflow-hidden flex flex-col justify-between">
        {/* Ambient background glow */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-teal-500/10 rounded-full blur-[80px] pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="text-3xl md:text-4xl font-display font-light text-white tracking-tight">Shift Overview</h2>
            <p className="text-zinc-400 mt-1 uppercase tracking-widest text-xs font-semibold">{shiftLine}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-300 bg-white/5 px-4 py-2 rounded-full border border-white/10 w-fit">
            <Activity className="w-4 h-4 text-emerald-400" /> 
            Live Census sync active
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <HeroStat
            label="Assigned Residents"
            value={brief.census}
            icon={<UserRound />}
            glowColor="rgba(255,255,255,0.05)"
            href="/caregiver/residents"
          />
          <HeroStat
            label="High Priority"
            value={brief.highSeverityConditionCount}
            icon={<ShieldAlert />}
            glowColor={brief.highSeverityConditionCount > 0 ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.05)"}
            danger={brief.highSeverityConditionCount > 0}
            href="/caregiver/followups"
          />
          <HeroStat
            label="eMAR Window"
            value={emarWindow}
            icon={<Pill />}
            glowColor={emarWindow > 0 ? "rgba(45,212,191,0.2)" : "rgba(255,255,255,0.05)"}
            accent={emarWindow > 0}
            href="/caregiver/meds"
          />
          <HeroStat
            label="Pending Docs"
            value={docPending}
            icon={<ClipboardList />}
            glowColor={docPending > 0 ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.05)"}
            warning={docPending > 0}
            href="/caregiver/prn-followup"
          />
        </div>
      </div>

      {/* ─── ROW 2: QUICK ACTIONS & ALERTS ───────────────────────────────────── */}
      <div className="glass-card rounded-[1.5rem] md:col-span-2 p-6 flex flex-col border-t border-t-white/20">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-1.5 h-6 bg-teal-400 rounded-full" />
          <h3 className="text-lg font-display font-medium text-white">Quick Actions</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
          <ActionTile 
            href="/caregiver/meds" 
            icon={<Pill className="text-teal-300" />} 
            title="Open eMAR" 
            gradient="from-teal-900/40 to-teal-950/40 hover:from-teal-800/60 hover:to-teal-900/60"
            border="border-teal-500/30"
          />
          <ActionTile 
            href="/caregiver/incident-draft" 
            icon={<AlertTriangle className="text-amber-300" />} 
            title="Report Incident" 
            gradient="from-amber-900/40 to-amber-950/40 hover:from-amber-800/60 hover:to-amber-900/60"
            border="border-amber-500/30"
          />
          <ActionTile 
            href="/caregiver/rounds" 
            icon={<CheckCircle2 className="text-emerald-300" />} 
            title="Smart Rounds" 
            gradient="from-emerald-900/40 to-emerald-950/40 hover:from-emerald-800/60 hover:to-emerald-900/60"
            border="border-emerald-500/30"
          />
          <ActionTile 
            href="/caregiver/clock" 
            icon={<LogIn className="text-indigo-300" />} 
            title="Clock In / Out" 
            gradient="from-indigo-900/40 to-indigo-950/40 hover:from-indigo-800/60 hover:to-indigo-900/60"
            border="border-indigo-500/30"
          />
        </div>
      </div>

      {/* ALERTS COLUMN */}
      <div className="md:col-span-2 flex flex-col gap-4 md:gap-6">
        {activeOutbreak && (
          <div className="rounded-[1.5rem] bg-rose-950/40 backdrop-blur-xl border border-rose-500/30 p-5 shadow-[0_0_30px_rgba(225,29,72,0.15)] relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <ShieldAlert className="w-24 h-24 text-rose-500" />
            </div>
            <div className="relative z-10">
              <h3 className="text-rose-200 font-display font-semibold mb-1 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
                Active Protocol: {activeOutbreak.infection_type.replace(/_/g, " ")}
              </h3>
              <p className="text-sm text-rose-200/70 mb-3">
                Strict facility protocols are in effect. Check your assigned task list.
              </p>
              {myOutbreakActions > 0 && (
                <div className="inline-flex items-center gap-2 bg-rose-900/60 px-3 py-1.5 rounded-lg border border-rose-700/50">
                  <CheckCircle2 className="w-4 h-4 text-rose-300" />
                  <span className="text-xs font-semibold text-rose-100">{myOutbreakActions} tasks assigned to you</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="glass-card rounded-[1.5rem] flex-1 p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-display font-medium text-white">Critical Updates</h3>
          </div>
          
          <div className="space-y-3 flex-1">
            {brief.criticalAlerts.length === 0 ? (
              <div className="h-full flex items-center justify-center border-2 border-dashed border-white/10 rounded-xl p-6 text-center">
                <p className="text-sm font-medium tracking-wide text-zinc-500">No high-priority conditions reported.</p>
              </div>
            ) : (
              brief.criticalAlerts.map((a) => (
                <Link
                  key={a.id}
                  href={`/caregiver/resident/${a.residentId}/condition-change`}
                  className="group flex flex-col rounded-xl border border-amber-900/40 bg-zinc-950/50 p-4 transition-all hover:bg-zinc-900/80 hover:border-amber-700/50 tap-responsive"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-100 group-hover:text-amber-100 transition-colors">{a.title}</p>
                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider border border-amber-900/60 bg-amber-500/10 text-amber-400 shrink-0">
                      {a.badge}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">{a.detail}</p>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─── ROW 3: WORKFLOWS & WATCHLIST ───────────────────────────────────── */}
      <div className="glass-card rounded-[1.5rem] md:col-span-2 p-6 flex flex-col">
        <h3 className="text-lg font-display font-medium text-white mb-1">Shift Workflows</h3>
        <p className="text-xs tracking-wide text-zinc-400 uppercase mb-6 font-semibold">Routine & Follow-ups</p>
        
        <div className="flex flex-col gap-2 flex-1">
          <WorkflowRow href="/caregiver/schedules" icon={<CalendarDays />} label="My Schedule" />
          <WorkflowRow href="/caregiver/followups" icon={<BellRing />} label="Condition Follow-ups" />
          <WorkflowRow href="/caregiver/handoff" icon={<MessageSquare />} label="Shift Handoff" />
          <WorkflowRow href="/caregiver/prn-followup" icon={<Pill />} label="PRN Reassessment" />
        </div>
      </div>

      <div className="glass-panel rounded-[1.5rem] md:col-span-2 p-6 flex flex-col border border-zinc-800/80 bg-zinc-950/80">
        <h3 className="text-lg font-display font-medium text-white mb-1">Watchlist</h3>
        <p className="text-xs tracking-wide text-zinc-400 uppercase mb-4 font-semibold">Elevated Acuity / Safety</p>
        
        <div className="flex-1 overflow-y-auto max-h-[300px] pr-2 space-y-3 premium-scrollbar">
          {brief.watchlist.length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center bg-white/5 rounded-xl border border-white/5">Census stable. No elevated watch filters.</p>
          ) : (
            brief.watchlist.map((w) => (
              <Link
                key={w.id}
                href={`/caregiver/resident/${w.id}`}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:bg-white/[0.06] hover:border-white/10 cursor-pointer group"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <UserRound className="h-4 w-4 text-zinc-400 group-hover:text-white transition-colors" />
                    <p className="text-sm font-semibold text-zinc-100">{w.name}</p>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 font-mono">RM {w.room}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {w.flags.map((flag) => (
                      <span key={flag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border border-zinc-700/50 bg-zinc-800/50 text-zinc-300">
                        <Waves className="mr-1 h-2.5 w-2.5 text-zinc-500" />
                        {flag}
                      </span>
                    ))}
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-white transition-colors" />
              </Link>
            ))
          )}
        </div>
      </div>

    </div>
  );
}

/* ─── HELPER COMPONENTS ──────────────────────────────────────────────────── */

function HeroStat({
  label,
  value,
  icon,
  glowColor,
  danger,
  warning,
  accent,
  href,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  glowColor: string;
  danger?: boolean;
  warning?: boolean;
  accent?: boolean;
  href?: string;
}) {
  const valueColor = danger ? "text-rose-400" : warning ? "text-amber-400" : accent ? "text-teal-400" : "text-white";
  const inner = (
    <div className="flex flex-col gap-1 z-10 relative">
      <div className="flex items-center gap-2 mb-2 text-zinc-400">
        <div className="w-5 h-5 opacity-80">{icon}</div>
        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <div className={`text-4xl md:text-5xl font-display font-medium tabular-nums tracking-tight ${valueColor}`}>
        {value}
      </div>
    </div>
  );

  const baseClass = "relative rounded-2xl border border-white/10 bg-white/[0.03] p-5 overflow-hidden group";
  const hoverClass = href ? " cursor-pointer hover:bg-white/[0.06] hover:border-white/20 transition-colors" : "";

  if (href) {
    return (
      <Link
        href={href}
        className={baseClass + hoverClass}
        style={{ boxShadow: `inset 0 0 40px ${glowColor}` }}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={baseClass}
      style={{ boxShadow: `inset 0 0 40px ${glowColor}` }}
    >
      {inner}
    </div>
  );
}

function ActionTile({ 
  href, 
  icon, 
  title, 
  gradient,
  border
}: { 
  href: string; 
  icon: React.ReactNode; 
  title: string;
  gradient: string;
  border: string;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-col justify-center rounded-2xl border bg-gradient-to-br ${gradient} ${border} p-5 tap-responsive transition-all duration-300 shadow-lg group relative overflow-hidden`}
    >
      <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 pointer-events-none" />
      <div className="bg-black/20 w-10 h-10 rounded-xl flex items-center justify-center mb-3 shadow-inner">
        {icon}
      </div>
      <span className="text-sm font-semibold text-white tracking-wide">{title}</span>
    </Link>
  );
}

function WorkflowRow({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.08] hover:border-white/10 transition-all tap-responsive group"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-zinc-900 group-hover:bg-zinc-800 text-zinc-400 group-hover:text-white transition-colors">
          {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "w-5 h-5" })}
        </div>
        <span className="text-sm font-medium text-zinc-200 group-hover:text-white">{label}</span>
      </div>
      <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-white transition-colors" />
    </Link>
  );
}
