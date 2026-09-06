"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getDashboardRouteForUser } from "@/lib/auth/user-home-route";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { FloorWorkflowStrip } from "@/components/caregiver/FloorWorkflowStrip";
import {
  CAREGIVER_EMAR_BACK_TO_SHIFT_COPY,
  CAREGIVER_EMAR_LOADING_COPY,
  caregiverEmarEmptyNoticeHelper,
  caregiverEmarEmptyNoticeTitle,
  caregiverEmarMetricDisplay,
  formatCaregiverEmarRoomLabel,
  type CaregiverEmarMetricKey,
} from "@/lib/caregiver/emar-queue-copy";

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
  const [residentFilter, setResidentFilter] = useState("");
  const [slots, setSlots] = useState<EmarQueueSlot[]>([]);
  const requestIds = useRef(new Map<string, string>());
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [homeHref, setHomeHref] = useState("/caregiver");

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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setHomeHref(getDashboardRouteForUser(user, "/caregiver"));
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
          start_date,
          end_date,
          scheduled_times,
          instructions,
          prn_max_frequency,
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
            roomByResident.set(rid, formatCaregiverEmarRoomLabel({}));
            continue;
          }
          const bed = bedById.get(res.bed_id);
          const room = bed?.room_id ? roomById.get(bed.room_id) : null;
          roomByResident.set(
            rid,
            formatCaregiverEmarRoomLabel({
              roomNumber: room?.room_number,
              bedLabel: bed?.bed_label,
            }),
          );
        }
      }

      const now = new Date();
      const ymd = zonedYmd(now, c.timeZone);
      const startUtc = toDate(`${ymd}T00:00:00`, { timeZone: c.timeZone }).toISOString();
      const endUtc = toDate(`${ymd}T23:59:59.999`, { timeZone: c.timeZone }).toISOString();

      const emarQ = await supabase
        .from("emar_records")
        .select("resident_medication_id, scheduled_time, actual_time, is_prn, status")
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

      const lastPrnByMedication = new Map<string, string | null>();
      await Promise.all(medsFiltered.filter((m) => m.frequency === "prn").map(async (med) => {
        const last = await supabase.from("emar_records").select("actual_time").eq("resident_medication_id", med.id).eq("is_prn", true).eq("status", "given").is("deleted_at", null).order("actual_time", { ascending: false }).limit(1).maybeSingle();
        if (last.error) throw last.error;
        lastPrnByMedication.set(med.id, last.data?.actual_time ?? null);
      }));
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
          start_date: m.start_date,
          end_date: m.end_date,
          scheduled_times: (m.scheduled_times ?? []) as string[],
          lastAdministrationIso: lastPrnByMedication.get(m.id),
          instructions: [m.instructions, m.frequency === "prn" ? m.prn_max_frequency : null].filter(Boolean).join(" · "),
          resident: { first_name: res?.first_name ?? r.first_name, last_name: res?.last_name ?? r.last_name },
          roomLabel: roomByResident.get(m.resident_id) ?? formatCaregiverEmarRoomLabel({}),
        };
      });

      const residentScope = new URLSearchParams(window.location.search).get("resident") ?? "";
      setResidentFilter(residentScope);
      const built = buildEmarQueueSlots(medInputs.filter((m) => !residentScope || m.resident_id === residentScope), c.timeZone, now, docKeys);
      const older = await supabase.from("emar_records").select("id,resident_medication_id,scheduled_time").eq("facility_id", c.facilityId).eq("status", "scheduled").eq("is_prn", false).lt("scheduled_time", startUtc).is("deleted_at", null).order("scheduled_time");
      if (older.error) throw older.error;
      for (const pending of older.data ?? []) {
        const med = medInputs.find((m) => m.id === pending.resident_medication_id && (!residentScope || m.resident_id === residentScope));
        if (!med) continue;
        built.unshift({ queueKey: `${med.id}|${pending.scheduled_time}`, residentMedicationId: med.id, residentId: med.resident_id, residentName: `${med.resident.first_name ?? ""} ${med.resident.last_name ?? ""}`.trim(), roomLabel: med.roomLabel, medicationLabel: [med.medication_name, med.strength].filter(Boolean).join(" "), routeLabel: med.route, scheduleLabel: new Date(pending.scheduled_time).toLocaleString("en-US", { timeZone: c.timeZone }), scheduledTimeIso: pending.scheduled_time, isPrn: false, instructions: med.instructions, urgency: "due-now" });
      }
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

  async function documentDose(slot: EmarQueueSlot, status: "given" | "refused", reason: string) {
    if (!ctx || actingKey) return;
    if ((slot.isPrn || status === "refused") && !reason.trim()) {
      setLoadError("Enter the PRN indication or refusal reason before saving.");
      return;
    }
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
      const requestId = requestIds.current.get(slot.queueKey) ?? crypto.randomUUID();
      requestIds.current.set(slot.queueKey, requestId);
      const result = await supabase.rpc("record_caregiver_emar_review" as never, { p_request_id: requestId, p_medication_id: slot.residentMedicationId, p_scheduled_at: slot.scheduledTimeIso, p_status: status, p_reason: reason } as never);
      if (result.error) throw result.error;
      if (typeof result.data !== "string") throw new Error("No saved MAR receipt was returned. Keep this entry and retry.");
      requestIds.current.delete(slot.queueKey);
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not save eMAR entry.");
    } finally {
      setActingKey(null);
    }
  }

  if (configError) {
    return (
      <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 px-6 py-4 text-sm text-rose-100 ">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-zinc-400">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
        <p className="text-sm font-medium tracking-wide">{CAREGIVER_EMAR_LOADING_COPY}</p>
      </div>
    );
  }

  if (loadError && !ctx) {
    return (
      <div className="space-y-4 max-w-md mx-auto mt-12">
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-6 py-5 text-sm text-rose-100 text-center">
          <ShieldAlert className="w-8 h-8 mx-auto mb-3 text-rose-400" />
          <p>{loadError}</p>
        </div>
        <Link
          href={homeHref}
          className="flex h-14 items-center justify-center rounded-2xl bg-white/10 border border-white/20 text-sm font-semibold text-white hover:bg-white/20 transition-colors tap-responsive"
        >
          {CAREGIVER_EMAR_BACK_TO_SHIFT_COPY}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto pb-6 space-y-6">
      <FloorWorkflowStrip
        active="meds"
        title="Stay in the medication lane while the pass window is active."
        description="Use controlled count for reconciliation, PRN follow-up for effectiveness checks, and incident report when a medication exception becomes a reportable event."
      />
      
      {/* ─── HIGHLIGHT BAR ─────────────────────────────────────────────────── */}
      <Link
        href="/caregiver/controlled-count"
        className="flex items-center justify-between rounded-full border border-teal-500/30 bg-teal-900/30 px-5 py-3.5 text-sm text-teal-100 hover:bg-teal-900/50 transition-colors tap-responsive"
      >
        <span className="flex items-center gap-3 font-semibold tracking-wide">
          <Shield className="h-4 w-4 text-teal-400" />
          Controlled substance count
        </span>
        <span className="text-[10px] uppercase tracking-wider font-bold text-teal-300 bg-teal-950/40 px-2.5 py-1 rounded-full border border-teal-800/50">Shift reconciliation</span>
      </Link>

      {/* ─── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">eMAR Queue</h1>
          <p className="text-zinc-400 mt-1 uppercase tracking-wider text-xs font-semibold">
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

      {residentFilter && <Link href="/caregiver/meds" className="text-sm underline">Show all residents</Link>}

      {/* ─── METRICS BLOCK ─────────────────────────────────────────────────── */}
      <div className="rounded-lg p-4 flex flex-wrap gap-2 md:grid md:grid-cols-3 border border-white/5 bg-slate-900/40">
        <EmarMetricPill
          label="Due now / overdue"
          metricKey="due-now"
          count={counts.dueNow}
          queueHasSlots={slots.length > 0}
          tone="danger"
        />
        <EmarMetricPill
          label="Due < 90 min"
          metricKey="due-soon"
          count={counts.dueSoon}
          queueHasSlots={slots.length > 0}
          tone="warning"
        />
        <EmarMetricPill
          label="In window"
          metricKey="in-window"
          count={counts.total}
          queueHasSlots={slots.length > 0}
          tone="muted"
        />
      </div>

      {/* ─── QUEUE LIST ────────────────────────────────────────────────────── */}
      <div className="space-y-4 pt-4">
        {slots.length === 0 ? (
          <section
            aria-label="Medication pass queue status"
            className="rounded-lg border border-white/10 bg-slate-900/40 px-5 py-4"
            role="status"
          >
            <p className="text-sm font-medium text-white">{caregiverEmarEmptyNoticeTitle()}</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{caregiverEmarEmptyNoticeHelper()}</p>
          </section>
        ) : (
          <MotionList className="space-y-4">
            {slots.map((item) => (
              <MotionItem key={item.queueKey}>
                <MedicationCard
                  item={item}
                  busy={actingKey !== null}
                  onGiven={(reason) => void documentDose(item, "given", reason)}
                  onRefused={(reason) => void documentDose(item, "refused", reason)}
                />
              </MotionItem>
            ))}
          </MotionList>
        )}
      </div>

    </div>
  );
}

function EmarMetricPill({
  label,
  metricKey,
  count,
  queueHasSlots,
  tone,
}: {
  label: string;
  metricKey: CaregiverEmarMetricKey;
  count: number;
  queueHasSlots: boolean;
  tone: "muted" | "warning" | "danger" | "success";
}) {
  const display = caregiverEmarMetricDisplay(count, metricKey, queueHasSlots);
  const toneClass =
    tone === "danger"
      ? "bg-rose-950/40 text-rose-100 border-transparent shadow-[inset_0_0_20px_rgba(225,29,72,0.15)]"
      : tone === "warning"
        ? "bg-amber-950/30 text-amber-100 border-transparent"
        : "bg-white/5 text-zinc-100 border-transparent";

  return (
    <div className={`flex-1 min-w-[120px] rounded-[1.2rem] border px-5 py-4 flex flex-col justify-between ${toneClass}`}>
      <div className="mb-2 uppercase tracking-wider text-[10px] font-bold text-zinc-400">
        {label}
      </div>
      {display.mode === "number" ? (
        <div className="text-3xl font-medium tabular-nums tracking-tight">{display.text}</div>
      ) : (
        <div className="text-[13px] font-medium leading-snug text-zinc-300">{display.text}</div>
      )}
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
  onGiven: (reason: string) => void;
  onRefused: (reason: string) => void;
}) {
  const isDueNow = item.urgency === "due-now";
  const [reason, setReason] = useState("");

  return (
    <div className={`rounded-xl p-6 transition-all relative overflow-hidden  border ${
       isDueNow 
         ? "bg-rose-950/10 border-rose-500/30 shadow-[inset_0_0_40px_rgba(225,29,72,0.1)]"
         : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04]"
    }`}>
      
      {/* Left side color accent bar for visual scanning */}
      <div className={`absolute top-0 bottom-0 left-0 w-1.5 ${isDueNow ? 'bg-rose-500' : 'bg-transparent'}`}></div>

      <div className="flex flex-col gap-5 md:pl-2">
         <div className="flex items-start justify-between gap-4">
            <div>
               <h3 className="text-xl md:text-2xl text-white tracking-wide">{item.medicationLabel}</h3>
               <p className="text-zinc-400 text-sm font-medium mt-1">
                 {item.residentName} <span className="mx-2 opacity-50">&middot;</span> Rm {item.roomLabel}
               </p>
            </div>
            {/* Status indicator pill */}
            <div className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
               isDueNow ? "bg-rose-500/20 text-rose-300 border-rose-500/30" : "bg-amber-500/10 text-amber-300 border-amber-500/30"
            }`}>
               {item.isPrn ? "As needed" : isDueNow ? "Due / needs resolution" : "Due Soon"}
            </div>
         </div>

         {/* Instructions block */}
         <div className="flex flex-wrap items-center gap-3 py-3 border-y border-white/5">
           <span className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-300 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5 shadow-inner">
             <Pill className="h-3.5 w-3.5 text-primary-400" />
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

         {item.isPrn && <p className="text-sm text-zinc-300">Last recorded administration: {item.lastAdministrationIso ? new Date(item.lastAdministrationIso).toLocaleString() : "None recorded"}. Check the order restrictions before any repeat dose.</p>}
         <label className="text-sm text-zinc-300">{item.isPrn ? "Indication and order restrictions checked" : "Refusal reason (required if refused)"}
           <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-lg border border-white/20 bg-black/30 p-3" />
         </label>
         <div className="grid grid-cols-2 gap-3 mt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onGiven(reason)}
              className="h-14 rounded-xl flex items-center justify-center font-bold tracking-wide transition-all shadow-[0_4px_20px_rgba(16,185,129,0.15)] bg-emerald-500 border border-emerald-400 text-black hover:bg-emerald-400 disabled:opacity-50 tap-responsive"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="mr-2 h-5 w-5" />}
              MARK GIVEN
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => onRefused(reason)}
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
