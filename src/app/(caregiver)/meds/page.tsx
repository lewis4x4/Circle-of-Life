"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clock3, Loader2, Pill, Shield, ShieldAlert, X, RefreshCw } from "lucide-react";
import { toDate } from "date-fns-tz";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import {
  buildEmarQueueSlots,
  documentedSlotKeys,
  zonedYmd,
  type EmarQueueSlot,
} from "@/lib/caregiver/emar-queue";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type ResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  bed_id: string | null;
};

type BedRow = { id: string; room_id: string | null; bed_label: string; current_resident_id: string | null };
type RoomRow = { id: string; room_number: string };

type MedRow = Database["public"]["Tables"]["resident_medications"]["Row"] & {
  residents: Pick<Database["public"]["Tables"]["residents"]["Row"], "first_name" | "last_name"> | null;
};

export default function CaregiverMedsPage() {
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
  const [slots, setSlots] = useState<EmarQueueSlot[]>([]);
  const [actingKey, setActingKey] = useState<string | null>(null);

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
      const { ctx: c } = resolved;
      setCtx(c);

      const medRes = await supabase
        .from("resident_medications")
        .select(
          `
          id,
          resident_id,
          facility_id,
          organization_id,
          medication_name,
          strength,
          route,
          frequency,
          scheduled_times,
          instructions,
          status,
          residents!inner ( first_name, last_name )
        `,
        )
        .eq("facility_id", c.facilityId)
        .eq("status", "active")
        .is("deleted_at", null);

      if (medRes.error) throw medRes.error;
      const raw = (medRes.data ?? []) as unknown as MedRow[];
      const medsFiltered = raw.filter((m) => m.residents != null);

      const resIds = [...new Set(medsFiltered.map((m) => m.resident_id))];
      const resById = new Map<string, ResidentMini>();
      if (resIds.length > 0) {
        const resQ = await supabase
          .from("residents")
          .select("id, first_name, last_name, bed_id")
          .in("id", resIds)
          .is("deleted_at", null);
        if (resQ.error) throw resQ.error;
        for (const r of resQ.data ?? []) {
          resById.set(r.id, r as ResidentMini);
        }
      }

      const bedIds = [...new Set([...resById.values()].map((r) => r.bed_id).filter(Boolean))] as string[];
      const roomByResident = new Map<string, string>();
      if (bedIds.length > 0) {
        const bedsQ = await supabase
          .from("beds")
          .select("id, room_id, bed_label, current_resident_id")
          .in("id", bedIds)
          .is("deleted_at", null);
        if (bedsQ.error) throw bedsQ.error;
        const beds = (bedsQ.data ?? []) as BedRow[];
        const roomIds = [...new Set(beds.map((b) => b.room_id).filter(Boolean))] as string[];
        let roomById = new Map<string, RoomRow>();
        if (roomIds.length > 0) {
          const roomsQ = await supabase.from("rooms").select("id, room_number").in("id", roomIds).is("deleted_at", null);
          if (roomsQ.error) throw roomsQ.error;
          roomById = new Map((roomsQ.data ?? []).map((r) => [r.id, r as RoomRow]));
        }
        const bedById = new Map(beds.map((b) => [b.id, b]));
        for (const [rid, res] of resById) {
          if (!res.bed_id) {
            roomByResident.set(rid, "—");
            continue;
          }
          const bed = bedById.get(res.bed_id);
          const room = bed?.room_id ? roomById.get(bed.room_id) : null;
          const label = room?.room_number
            ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}`
            : "—";
          roomByResident.set(rid, label);
        }
      }

      const now = new Date();
      const ymd = zonedYmd(now, c.timeZone);
      const startUtc = toDate(`${ymd}T00:00:00`, { timeZone: c.timeZone }).toISOString();
      const endUtc = toDate(`${ymd}T23:59:59.999`, { timeZone: c.timeZone }).toISOString();

      const emarQ = await supabase
        .from("emar_records")
        .select("resident_medication_id, scheduled_time, is_prn, status")
        .eq("facility_id", c.facilityId)
        .gte("scheduled_time", startUtc)
        .lte("scheduled_time", endUtc)
        .is("deleted_at", null);

      if (emarQ.error) throw emarQ.error;
      const docKeys = documentedSlotKeys(
        (emarQ.data ?? []) as {
          resident_medication_id: string;
          scheduled_time: string;
          is_prn: boolean;
          status: string;
        }[],
        c.timeZone,
        ymd,
      );

      const medInputs = medsFiltered.map((m) => {
        const res = resById.get(m.resident_id);
        const r = m.residents!;
        return {
          id: m.id,
          resident_id: m.resident_id,
          medication_name: m.medication_name,
          strength: m.strength,
          route: m.route,
          frequency: m.frequency,
          scheduled_times: (m.scheduled_times ?? []) as string[],
          instructions: m.instructions,
          resident: { first_name: res?.first_name ?? r.first_name, last_name: res?.last_name ?? r.last_name },
          roomLabel: roomByResident.get(m.resident_id) ?? "—",
        };
      });

      const built = buildEmarQueueSlots(medInputs, c.timeZone, now, docKeys);
      setSlots(built);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load eMAR queue.");
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const dueNow = slots.filter((s) => s.urgency === "due-now").length;
    const dueSoon = slots.filter((s) => s.urgency === "due-soon").length;
    return { dueNow, dueSoon, total: slots.length };
  }, [slots]);

  async function documentDose(slot: EmarQueueSlot, status: "given" | "refused") {
    if (!ctx) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Session expired. Sign in again.");
      return;
    }

    setActingKey(slot.queueKey);
    setLoadError(null);
    try {
      const row: Database["public"]["Tables"]["emar_records"]["Insert"] = {
        resident_id: slot.residentId,
        resident_medication_id: slot.residentMedicationId,
        facility_id: ctx.facilityId,
        organization_id: ctx.organizationId,
        scheduled_time: slot.scheduledTimeIso,
        actual_time: new Date().toISOString(),
        status,
        administered_by: user.id,
        is_prn: slot.isPrn,
        created_by: user.id,
        refusal_reason: status === "refused" ? "Refused (floor documentation)" : null,
      };
      const ins = await supabase.from("emar_records").insert(row).select("id").single();
      if (ins.error) throw ins.error;
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not save eMAR entry.");
    } finally {
      setActingKey(null);
    }
  }

  if (configError) {
    return (
      <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 px-6 py-4 text-sm text-rose-100 backdrop-blur-md">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-zinc-400">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
        <p className="text-sm font-medium tracking-wide uppercase">Syncing eMAR…</p>
      </div>
    );
  }

  if (loadError && !ctx) {
    return (
      <div className="space-y-4 max-w-md mx-auto mt-12">
        <div className="rounded-[1.5rem] border border-rose-800/60 bg-rose-950/30 px-6 py-5 text-sm text-rose-100 text-center">
          <ShieldAlert className="w-8 h-8 mx-auto mb-3 text-rose-400" />
          <p>{loadError}</p>
        </div>
        <Link
          href="/caregiver"
          className="flex h-14 items-center justify-center rounded-2xl bg-white/10 border border-white/20 text-sm font-semibold text-white hover:bg-white/20 transition-colors tap-responsive"
        >
          Back to shift dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto pb-6 space-y-6">
      
      {/* ─── HIGHLIGHT BAR ─────────────────────────────────────────────────── */}
      <Link
        href="/caregiver/controlled-count"
        className="flex items-center justify-between rounded-full border border-teal-500/30 bg-teal-900/30 backdrop-blur-xl px-5 py-3.5 text-sm text-teal-100 hover:bg-teal-900/50 transition-colors tap-responsive"
      >
        <span className="flex items-center gap-3 font-semibold tracking-wide">
          <Shield className="h-4 w-4 text-teal-400" />
          Controlled substance count
        </span>
        <span className="text-[10px] uppercase tracking-widest font-bold text-teal-300 bg-teal-950/40 px-2.5 py-1 rounded-full border border-teal-800/50">Shift reconciliation</span>
      </Link>

      {/* ─── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-light text-white tracking-tight">eMAR Queue</h1>
          <p className="text-zinc-400 mt-1 uppercase tracking-widest text-xs font-semibold">
            {ctx?.facilityName ? `${ctx.facilityName} · TZ: ${ctx.timeZone.split("/").pop()}` : "Document medication passes."}
          </p>
        </div>
        <button 
           onClick={() => void load()}
           className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors border border-white/5 tap-responsive"
        >
           <RefreshCw className="w-4 h-4 text-zinc-300" />
        </button>
      </div>

      {loadError && (
        <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-5 py-3 text-sm font-medium text-amber-200">
          {loadError}
        </div>
      )}

      {/* ─── METRICS BLOCK ─────────────────────────────────────────────────── */}
      <div className="glass-panel rounded-[2rem] p-4 flex flex-wrap gap-2 md:grid md:grid-cols-3 border border-white/5 bg-slate-900/40 backdrop-blur-xl">
        <MetricPill label="Due now / overdue" value={String(counts.dueNow)} tone="danger" />
        <MetricPill label="Due < 90 min" value={String(counts.dueSoon)} tone="warning" />
        <MetricPill label="In window" value={String(counts.total)} tone="neutral" />
      </div>

      {/* ─── QUEUE LIST ────────────────────────────────────────────────────── */}
      <div className="space-y-4 pt-4">
        {slots.length === 0 ? (
           <div className="glass-panel rounded-[2rem] border-dashed border-2 border-white/10 p-12 text-center bg-transparent backdrop-blur-md">
             <Pill className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
             <p className="text-lg text-white font-medium mb-1">Queue is clear.</p>
             <p className="text-sm text-zinc-500 font-medium tracking-wide">No medication passes left in the current window.</p>
           </div>
        ) : (
          <MotionList className="space-y-4">
            {slots.map((item) => (
              <MotionItem key={item.queueKey}>
                <MedicationCard
                  item={item}
                  busy={actingKey === item.queueKey}
                  onGiven={() => void documentDose(item, "given")}
                  onRefused={() => void documentDose(item, "refused")}
                />
              </MotionItem>
            ))}
          </MotionList>
        )}
      </div>

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
      ? "bg-rose-950/40 text-rose-100 border-transparent shadow-[inset_0_0_20px_rgba(225,29,72,0.15)]"
      : tone === "warning"
        ? "bg-amber-950/30 text-amber-100 border-transparent"
        : "bg-white/5 text-zinc-100 border-transparent";
          
  return (
    <div className={`flex-1 min-w-[120px] rounded-[1.2rem] border px-5 py-4 flex flex-col justify-between ${toneClass}`}>
      <div className="mb-2 uppercase tracking-widest text-[10px] font-bold text-zinc-400">
        {label}
      </div>
      <div className="text-3xl font-display font-medium tabular-nums tracking-tight">
         {value}
      </div>
    </div>
  );
}

function MedicationCard({
  item,
  busy,
  onGiven,
  onRefused,
}: {
  item: EmarQueueSlot;
  busy: boolean;
  onGiven: () => void;
  onRefused: () => void;
}) {
  const isDueNow = item.urgency === "due-now";

  return (
    <div className={`rounded-[2rem] p-6 transition-all relative overflow-hidden backdrop-blur-xl border ${
       isDueNow 
         ? "bg-rose-950/10 border-rose-500/30 shadow-[inset_0_0_40px_rgba(225,29,72,0.1)]"
         : "glass-panel bg-white/[0.02] border-white/5 hover:bg-white/[0.04]"
    }`}>
      
      {/* Left side color accent bar for visual scanning */}
      <div className={`absolute top-0 bottom-0 left-0 w-1.5 ${isDueNow ? 'bg-rose-500' : 'bg-transparent'}`}></div>

      <div className="flex flex-col gap-5 md:pl-2">
         <div className="flex items-start justify-between gap-4">
            <div>
               <h3 className="text-xl md:text-2xl font-display text-white tracking-wide">{item.medicationLabel}</h3>
               <p className="text-zinc-400 text-sm font-medium mt-1">
                 {item.residentName} <span className="mx-2 opacity-50">&middot;</span> Rm {item.roomLabel}
               </p>
            </div>
            {/* Status indicator pill */}
            <div className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
               isDueNow ? "bg-rose-500/20 text-rose-300 border-rose-500/30" : "bg-amber-500/10 text-amber-300 border-amber-500/30"
            }`}>
               {isDueNow ? "Due Now" : "Due Soon"}
            </div>
         </div>

         {/* Instructions block */}
         <div className="flex flex-wrap items-center gap-3 py-3 border-y border-white/5">
           <span className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-300 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5 shadow-inner">
             <Pill className="h-3.5 w-3.5 text-indigo-400" />
             {item.routeLabel}
           </span>
           <span className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-300 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5 shadow-inner">
             <Clock3 className="h-3.5 w-3.5 text-zinc-400" />
             {item.scheduleLabel}
           </span>
           <span className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-300 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5 shadow-inner">
             <ShieldAlert className="h-3.5 w-3.5 text-emerald-400" />
             {item.instructions}
           </span>
         </div>

         <div className="grid grid-cols-2 gap-3 mt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onGiven}
              className="h-14 rounded-xl flex items-center justify-center font-bold tracking-wide transition-all shadow-[0_4px_20px_rgba(16,185,129,0.15)] bg-emerald-500 border border-emerald-400 text-black hover:bg-emerald-400 disabled:opacity-50 tap-responsive"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="mr-2 h-5 w-5" />}
              MARK GIVEN
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={onRefused}
              className="h-14 rounded-xl flex items-center justify-center font-bold tracking-wide transition-all border border-white/10 bg-black/40 text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-50 tap-responsive shadow-inner"
            >
              <X className="mr-2 h-5 w-5" />
              REFUSED
            </button>
         </div>
      </div>
    </div>
  );
}
