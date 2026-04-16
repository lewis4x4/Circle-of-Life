"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, Loader2, UserRound } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { fetchActiveResidentsWithRooms, type ResidentWithRoom } from "@/lib/caregiver/facility-residents";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { ADL_OPTIONS, ASSIST_OPTIONS } from "@/lib/caregiver/adl-form-options";
import { fetchShiftDailyLogId } from "@/lib/caregiver/daily-log-link";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { FloorWorkflowStrip } from "@/components/caregiver/FloorWorkflowStrip";

export default function CaregiverTasksPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<{
    facilityId: string;
    organizationId: string;
    facilityName: string | null;
    timeZone: string;
  } | null>(null);
  const [residents, setResidents] = useState<ResidentWithRoom[]>([]);
  const [adlCountByResident, setAdlCountByResident] = useState<Map<string, number>>(new Map());
  const [submittingId, setSubmittingId] = useState<string | null>(null);

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
      const c = resolved.ctx;
      setCtx(c);
      const list = await fetchActiveResidentsWithRooms(supabase, c.facilityId);
      setResidents(list);

      const ymd = zonedYmd(new Date(), c.timeZone);
      const adlQ = await supabase
        .from("adl_logs")
        .select("resident_id")
        .eq("facility_id", c.facilityId)
        .eq("log_date", ymd)
        .is("deleted_at", null)
        .limit(2000);
      if (adlQ.error) throw adlQ.error;
      const counts = new Map<string, number>();
      for (const row of adlQ.data ?? []) {
        const rid = (row as { resident_id: string }).resident_id;
        counts.set(rid, (counts.get(rid) ?? 0) + 1);
      }
      setAdlCountByResident(counts);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load task queue.");
      setResidents([]);
      setAdlCountByResident(new Map());
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedResidents = useMemo(() => {
    return [...residents].sort((a, b) => {
      const ca = adlCountByResident.get(a.id) ?? 0;
      const cb = adlCountByResident.get(b.id) ?? 0;
      if (ca !== cb) return ca - cb;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [residents, adlCountByResident]);

  const metrics = useMemo(() => {
    let noPass = 0;
    for (const r of residents) {
      if ((adlCountByResident.get(r.id) ?? 0) === 0) noPass += 1;
    }
    const totalAdl = [...adlCountByResident.values()].reduce((a, b) => a + b, 0);
    return {
      residents: residents.length,
      noPass,
      totalAdl,
    };
  }, [residents, adlCountByResident]);

  async function logAdl(
    resident: ResidentWithRoom,
    payload: {
      adlType: string;
      assistance: Database["public"]["Enums"]["assistance_level"];
      refused: boolean;
      notes: string;
    },
  ) {
    if (!ctx) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Session expired. Sign in again.");
      return;
    }
    setSubmittingId(resident.id);
    setLoadError(null);
    try {
      const ymd = zonedYmd(new Date(), ctx.timeZone);
      const shift = currentShiftForTimezone(ctx.timeZone);
      const dailyLogId = await fetchShiftDailyLogId(supabase, {
        residentId: resident.id,
        facilityId: ctx.facilityId,
        logDate: ymd,
        shift,
        loggedBy: user.id,
      });
      const row: Database["public"]["Tables"]["adl_logs"]["Insert"] = {
        resident_id: resident.id,
        facility_id: ctx.facilityId,
        organization_id: ctx.organizationId,
        daily_log_id: dailyLogId,
        log_date: ymd,
        log_time: new Date().toISOString(),
        shift,
        logged_by: user.id,
        adl_type: payload.adlType,
        assistance_level: payload.assistance,
        refused: payload.refused,
        refusal_reason: payload.refused ? "Documented on floor device" : null,
        notes: payload.notes.trim() || null,
        detail_data: {},
      };
      const ins = await supabase.from("adl_logs").insert(row).select("id").single();
      if (ins.error) throw ins.error;
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not log ADL.");
    } finally {
      setSubmittingId(null);
    }
  }

  if (configError) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading queue…
      </div>
    );
  }

  if (loadError && !ctx) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">{loadError}</div>
        <Link
          href="/caregiver"
          className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        >
          Back to shift home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FloorWorkflowStrip
        active="tasks"
        title="Document routine care while the resident context is in front of you."
        description="Use the ADL queue for routine support passes, then move to rounds for due checks or meds when a medication window is active."
      />
      <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-white/5 bg-gradient-to-br from-cyan-950/40 via-slate-900/40 to-black/60 backdrop-blur-3xl shadow-2xl relative overflow-visible z-10 w-full transition-all text-zinc-100">
        <div className="mb-6">
          <h3 className="text-2xl font-display font-semibold text-white tracking-wide">Task &amp; ADL queue</h3>
          <p className="text-sm font-mono text-cyan-400/80 mt-1">
            {ctx?.facilityName ? (
              <>
                Live census at <span className="text-white font-bold">{ctx.facilityName}</span>. Log ADL passes against today&apos;s date
                in facility time.
              </>
            ) : (
              "Prioritize residents with fewer documented ADL passes today, then log each pass."
            )}
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricPill label="Residents in scope" value={String(metrics.residents)} tone="neutral" />
          <MetricPill label="No ADL yet today" value={String(metrics.noPass)} tone="danger" />
          <MetricPill label="ADL passes today" value={String(metrics.totalAdl)} tone="success" />
          <MetricPill label="Shift bucket" value={ctx ? currentShiftForTimezone(ctx.timeZone) : "—"} tone="neutral" />
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-100">{loadError}</div>
      ) : null}

      {sortedResidents.length === 0 ? (
        <div className="glass-panel p-8 rounded-2xl border border-white/5 bg-slate-900/40 text-center backdrop-blur-xl">
          <p className="text-sm font-mono text-zinc-400">No active residents in this facility scope. Add census in the admin console.</p>
        </div>
      ) : (
        <MotionList className="space-y-3">
          {sortedResidents.map((r) => (
            <MotionItem key={r.id}>
              <ResidentAdlCard
                resident={r}
                passesToday={adlCountByResident.get(r.id) ?? 0}
                busy={submittingId === r.id}
                onSubmit={(p) => void logAdl(r, p)}
              />
            </MotionItem>
          ))}
        </MotionList>
      )}
    </div>
  );
}

function MetricPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "bg-rose-950/30 border-rose-500/20 shadow-[inset_0_1px_10px_rgba(225,29,72,0.1)]"
      : tone === "warning"
        ? "bg-amber-950/30 border-amber-500/20 shadow-[inset_0_1px_10px_rgba(217,119,6,0.1)]"
        : tone === "success"
          ? "bg-emerald-950/30 border-emerald-500/20 shadow-[inset_0_1px_10px_rgba(16,185,129,0.1)]"
          : "bg-slate-900/40 border-white/5 shadow-[inset_0_1px_10px_rgba(255,255,255,0.02)]";

  return (
    <div className={`rounded-xl border p-4 backdrop-blur-xl ${toneClass}`}>
      <p className="text-[9px] uppercase tracking-widest font-mono text-zinc-400">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold font-display text-white">{value}</p>
    </div>
  );
}

function ResidentAdlCard({
  resident,
  passesToday,
  busy,
  onSubmit,
}: {
  resident: ResidentWithRoom;
  passesToday: number;
  busy: boolean;
  onSubmit: (p: {
    adlType: string;
    assistance: Database["public"]["Enums"]["assistance_level"];
    refused: boolean;
    notes: string;
  }) => void;
}) {
  const [adlType, setAdlType] = useState("rounding");
  const [assistance, setAssistance] = useState<Database["public"]["Enums"]["assistance_level"]>("supervision");
  const [refused, setRefused] = useState(false);
  const [notes, setNotes] = useState("");

  const priority = passesToday === 0 ? "critical" : passesToday < 2 ? "high" : "normal";
  const priorityClasses =
    priority === "critical"
      ? "border-rose-500/30 bg-gradient-to-br from-rose-950/40 to-black/60 shadow-[inset_0_1px_10px_rgba(225,29,72,0.1)] hover:border-rose-500/50"
      : priority === "high"
        ? "border-amber-500/30 bg-gradient-to-br from-amber-950/40 to-black/60 shadow-[inset_0_1px_10px_rgba(217,119,6,0.1)] hover:border-amber-500/50"
        : "border-emerald-500/10 bg-slate-900/40 shadow-[inset_0_1px_10px_rgba(16,185,129,0.05)] hover:border-emerald-500/30";

  return (
    <div className={`p-4 md:p-5 rounded-2xl glass-panel group transition-all duration-300 border backdrop-blur-xl overflow-hidden relative ${priorityClasses}`}>
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-[50px] -mr-10 -mt-10 pointer-events-none" />
      <div className="space-y-4 relative z-10 w-full">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${priority === 'critical' ? 'bg-rose-500/20 border-rose-500/40 text-rose-300' : priority === 'high' ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'}`}>
               <UserRound className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold text-white tracking-wide">{resident.displayName}</p>
              <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-400 mt-0.5">Room {resident.roomLabel}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Badge
              className={`rounded-full px-3 py-0.5 text-[9px] uppercase tracking-widest font-mono font-bold border ${
                priority === "critical"
                  ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                  : priority === "high"
                    ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                    : "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
              }`}
            >
              {priority === "critical" ? "No ADL yet" : priority === "high" ? "Light pass" : "Stable"}
            </Badge>
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase font-mono tracking-widest text-zinc-400">
              <Clock3 className="h-3 w-3" />
              {passesToday} pass{passesToday === 1 ? "" : "es"} today
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 pt-2">
          <div className="space-y-1.5 focus-within:text-cyan-400 transition-colors">
            <Label className="text-[10px] uppercase font-mono tracking-widest text-zinc-500 font-bold">ADL Type</Label>
            <select
              className="flex h-12 w-full rounded-full border border-white/10 bg-black/40 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 appearance-none font-mono"
              value={adlType}
              onChange={(e) => setAdlType(e.target.value)}
            >
              {ADL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-slate-900 text-sm">
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 focus-within:text-cyan-400 transition-colors">
            <Label className="text-[10px] uppercase font-mono tracking-widest text-zinc-500 font-bold">Assistance</Label>
            <select
              className="flex h-12 w-full rounded-full border border-white/10 bg-black/40 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 appearance-none font-mono"
              value={assistance}
              onChange={(e) => setAssistance(e.target.value as Database["public"]["Enums"]["assistance_level"])}
            >
              {ASSIST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-slate-900 text-sm">
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-2">
            <textarea
              rows={2}
              placeholder="Optional note (objective, brief)"
              className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 font-mono resize-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
        </div>
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
            <label className="flex items-center gap-3 text-sm text-zinc-300 shrink-0 cursor-pointer group">
              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${refused ? 'bg-cyan-500 border-cyan-500' : 'border-zinc-600 bg-black/40 group-hover:border-cyan-500/50'}`}>
                {refused && <CheckCircle2 className="w-3.5 h-3.5 text-black" />}
              </div>
              <input
                type="checkbox"
                className="hidden"
                checked={refused}
                onChange={(e) => setRefused(e.target.checked)}
              />
              <span className="font-mono text-xs uppercase tracking-widest select-none">Refused / deferred</span>
            </label>

            <Button
              type="button"
              disabled={busy}
              className={`h-12 rounded-full font-mono uppercase tracking-widest text-[10px] px-8 w-full sm:w-auto shadow-lg transition-all hover:scale-[1.02] border-0 text-zinc-950 font-bold ${refused ? 'bg-amber-400 hover:bg-amber-300 focus:ring-amber-500/50' : 'bg-cyan-400 hover:bg-cyan-300 focus:ring-cyan-500/50'}`}
              onClick={() => {
                onSubmit({ adlType, assistance, refused, notes });
                setNotes("");
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin text-zinc-950" /> : <CheckCircle2 className="mr-2 h-4 w-4 text-zinc-950" />}
              {refused ? "Log Deferral" : "Log ADL Pass"}
            </Button>
        </div>
      </div>
    </div>
  );
}
