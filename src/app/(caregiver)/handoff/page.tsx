"use client";
import { ShiftHandoffBoard } from "@/components/caregiver/ShiftHandoffBoard";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Loader2, MessageSquare } from "lucide-react";

import { ShiftEventsSummary } from "@/components/care-events/timeline/ShiftEventsSummary";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { loadCaregiverFacilityContext, type CaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { currentShiftFor, handoffShiftOf, nextShiftFor } from "@/lib/caregiver/shift";
import {
  HANDOFF_RECORDED_COPY,
  autoSummaryCareEventLines,
  nextShift,
  recordShiftHandoff,
  shiftWindowOf,
} from "@/lib/caregiver/handoff-summary";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { FloorWorkflowStrip } from "@/components/caregiver/FloorWorkflowStrip";
import { enumLabel } from "@/lib/display/enum-label";

type HandoffRow = {
  id: string;
  handoff_date: string;
  outgoing_shift: string;
  incoming_shift: string;
  outgoing_staff_id: string;
  incoming_staff_id: string | null;
  outgoing_notes: string | null;
  incoming_notes: string | null;
  incoming_acknowledged: boolean;
  auto_summary: unknown;
};

export default function CaregiverHandoffPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<HandoffRow[]>([]);
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [facilityCtx, setFacilityCtx] = useState<CaregiverFacilityContext | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordResult, setRecordResult] = useState<{ kind: "success" | "error"; text: string } | null>(null);

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
      const { facilityId } = resolved.ctx;
      setFacilityCtx(resolved.ctx);

      const hq = await supabase
        .from("shift_handoffs")
        .select(
          "id, handoff_date, outgoing_shift, incoming_shift, outgoing_staff_id, incoming_staff_id, outgoing_notes, incoming_notes, incoming_acknowledged, auto_summary",
        )
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .order("handoff_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20);
      if (hq.error) throw hq.error;

      const list = (hq.data ?? []) as HandoffRow[];
      setRows(list);

      const ids = new Set<string>();
      for (const h of list) {
        ids.add(h.outgoing_staff_id);
        if (h.incoming_staff_id) ids.add(h.incoming_staff_id);
      }
      const idArr = [...ids];
      const names = new Map<string, string>();
      if (idArr.length > 0) {
        const pq = await supabase.from("user_profiles").select("id, full_name").in("id", idArr);
        if (pq.error) throw pq.error;
        for (const p of pq.data ?? []) {
          names.set((p as { id: string; full_name: string }).id, (p as { full_name: string }).full_name);
        }
      }
      setNameById(names);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load handoffs.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Write this shift's handoff: the outgoing shift is the one on the floor now,
   * the incoming shift follows it (day, evening, night, day), handoff_date is
   * the date the outgoing window started in the facility zone (today, except a
   * night recorded after midnight files under yesterday), and auto_summary
   * carries every care event from that window grouped by level word (spec 07A §6.3).
   */
  const recordHandoff = useCallback(async () => {
    if (!facilityCtx || recording) return;
    setRecording(true);
    setRecordResult(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in again to record the handoff.");
      const now = new Date();
      // Outgoing and incoming shifts come from the facility's configured shifts (COL-659).
      const current = currentShiftFor(facilityCtx, now);
      const shift = handoffShiftOf(current, facilityCtx.timeZone);
      const incoming = nextShiftFor(facilityCtx, now);
      const date = current.serviceDate;
      await recordShiftHandoff(supabase, {
        facilityId: facilityCtx.facilityId,
        organizationId: facilityCtx.organizationId,
        timeZone: facilityCtx.timeZone,
        outgoingShift: shift,
        incomingShift: incoming ? handoffShiftOf(incoming, facilityCtx.timeZone) : nextShift(shift),
        handoffDate: zonedYmd(now, facilityCtx.timeZone),
        shiftDate: date,
        window: shiftWindowOf(current),
        outgoingStaffId: user.id,
        outgoingNotes: null,
        now,
      });
      setRecordResult({ kind: "success", text: HANDOFF_RECORDED_COPY });
      await load();
    } catch (e) {
      setRecordResult({ kind: "error", text: formatLiveDataLoadError(e, "The handoff could not be recorded. Try again.") });
    } finally {
      setRecording(false);
    }
  }, [facilityCtx, load, recording, supabase]);

  if (configError) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading handoffs…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">{loadError}</div>
    );
  }

  return (
    <div className="space-y-4">
      <FloorWorkflowStrip
        active="handoff"
        title="Use handoff as the final floor lane after meds, checks, and unresolved follow-up work are clear."
        description="This is where the next shift should understand what matters now. If something still needs action, link it back to meds, follow-ups, or incident reporting before turnover."
      />
      <div className="p-6 sm:p-8 rounded-lg border border-white/5 shadow-2xl relative overflow-visible z-10 w-full transition-all text-zinc-100">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-3 text-2xl font-semibold text-white tracking-wide">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              Shift handoff
            </h3>
            <p className="text-sm font-mono text-primary/60 mt-2 max-w-xl">
              Shared shift notes and earlier recorded handoffs for your working facility.
            </p>
          </div>
          <Badge className="border-primary/40 bg-primary/20 text-primary uppercase tracking-wider font-mono text-[10px] font-bold rounded-full px-4 py-1.5 shrink-0">
            Latest {rows.length ? `${rows.length}` : "0"} record{rows.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      {facilityCtx ? (
        <div className="space-y-3">
          <ShiftEventsSummary facilityId={facilityCtx.facilityId} timeZone={facilityCtx.timeZone} shifts={facilityCtx.shifts} />
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <Button
              type="button"
              className="min-h-14 w-full sm:w-auto"
              disabled={recording}
              aria-busy={recording}
              onClick={() => void recordHandoff()}
            >
              {recording ? "Recording handoff…" : "Record handoff"}
            </Button>
            {recordResult?.kind === "success" ? (
              <p role="status" aria-live="polite" className="text-sm text-foreground">
                {recordResult.text}
              </p>
            ) : null}
            {recordResult?.kind === "error" ? (
              <p role="alert" className="text-sm text-destructive">
                {recordResult.text}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <ShiftHandoffBoard />
      {rows.length === 0 ? (
        <div className="p-8 rounded-2xl border border-white/5 bg-slate-900/40 text-center">
          <p className="text-sm font-mono text-muted-foreground">No shift handoffs on file yet.</p>
        </div>
      ) : (
        <MotionList className="space-y-4">
          {rows.map((h) => {
            const summaryLines = autoSummaryLines(h.auto_summary);
            const outName = nameById.get(h.outgoing_staff_id) ?? "Staff";
            const inName = h.incoming_staff_id ? (nameById.get(h.incoming_staff_id) ?? "Staff") : "Unassigned";
            return (
              <MotionItem key={h.id}>
                <div className="p-6 rounded-2xl group transition-all duration-300 border border-white/5 bg-white/[0.02] overflow-hidden relative break-inside-avoid">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-white/5 pb-4 mb-4">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <ClipboardList className="h-5 w-5 text-muted-foreground" />
                        <span className="text-lg font-medium tracking-wide text-white">
                           {formatHandoffDate(h.handoff_date)}
                        </span>
                        <span className="text-muted-foreground font-mono tracking-wider text-[10px] uppercase font-bold">
                           {h.outgoing_shift} → {h.incoming_shift}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground font-medium pl-8">
                        Out: <span className="text-muted-foreground">{outName}</span>
                        {h.incoming_staff_id ? <><span className="mx-2">·</span>In: <span className="text-muted-foreground">{inName}</span></> : null}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center pr-2">
                       {h.incoming_acknowledged ? (
                         <Badge className="border-emerald-500/40 bg-emerald-500/20 text-emerald-300 uppercase tracking-wider font-mono text-[9px] font-bold rounded-full px-3 py-1 shadow-[inset_0_1px_10px_rgba(16,185,129,0.1)]">Acknowledged</Badge>
                       ) : (
                         <Badge className="border-amber-500/40 bg-amber-500/20 text-amber-300 uppercase tracking-wider font-mono text-[9px] font-bold rounded-full px-3 py-1 shadow-[inset_0_1px_10px_rgba(217,119,6,0.1)]">
                           Pending ack
                         </Badge>
                       )}
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {h.outgoing_notes?.trim() ? (
                      <div className="rounded-xl border border-white/5 bg-black/40 p-4 shadow-inner">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-mono mb-2">Outgoing notes</p>
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed font-mono">{h.outgoing_notes}</p>
                      </div>
                    ) : null}
                    {summaryLines.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-mono pl-1">Summary Items</p>
                        {summaryLines.map((line, idx) => (
                          <div
                            key={`${h.id}-s-${idx}`}
                            className="flex items-start gap-3 rounded-xl border border-white/5 bg-black/40 p-3 text-sm text-muted-foreground shadow-inner group-hover:border-white/10 transition-colors"
                          >
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500/80" aria-hidden />
                            <span className="font-mono leading-relaxed">{line}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {h.incoming_notes?.trim() ? (
                      <div className="rounded-xl border border-white/5 bg-black/40 p-4 shadow-inner">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-mono mb-2">Incoming notes</p>
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed font-mono">{h.incoming_notes}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </MotionItem>
            );
          })}
        </MotionList>
      )}
    </div>
  );
}

function autoSummaryLines(summary: unknown): string[] {
  if (summary == null || typeof summary !== "object" || Array.isArray(summary)) return [];
  // Spec 07A section 6.3: a care_events summary carries printable lines, one per event, grouped by level word.
  const out: string[] = autoSummaryCareEventLines(summary);
  for (const [k, v] of Object.entries(summary as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) {
      out.push(`${humanizeKey(k)}: ${v.trim()}`);
    }
  }
  return out;
}

function humanizeKey(k: string): string {
  return enumLabel(k, { case: "title" });
}

function formatHandoffDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}
