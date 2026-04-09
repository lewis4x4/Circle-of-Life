"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Loader2, MessageSquare } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

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

  if (configError) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
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
      <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-white/5 bg-gradient-to-br from-indigo-950/40 via-slate-900/40 to-black/60 backdrop-blur-3xl shadow-2xl relative overflow-visible z-10 w-full transition-all text-zinc-100">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-3 text-2xl font-display font-semibold text-white tracking-wide">
              <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                <MessageSquare className="h-5 w-5 text-indigo-400" />
              </div>
              Shift handoff
            </h3>
            <p className="text-sm font-mono text-indigo-200/60 mt-2 max-w-xl">
              Recent recorded handoffs for your facility (read-only). Create or edit handoffs from the nurse lead workflow when enabled.
            </p>
          </div>
          <Badge className="border-indigo-500/40 bg-indigo-500/20 text-indigo-300 uppercase tracking-widest font-mono text-[10px] font-bold rounded-full px-4 py-1.5 shrink-0">
            Latest {rows.length ? `${rows.length}` : "0"} record{rows.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="glass-panel p-8 rounded-2xl border border-white/5 bg-slate-900/40 text-center backdrop-blur-xl">
          <p className="text-sm font-mono text-zinc-400">No shift handoffs on file yet.</p>
        </div>
      ) : (
        <MotionList className="space-y-4">
          {rows.map((h) => {
            const summaryLines = autoSummaryLines(h.auto_summary);
            const outName = nameById.get(h.outgoing_staff_id) ?? "Staff";
            const inName = h.incoming_staff_id ? (nameById.get(h.incoming_staff_id) ?? "Staff") : "Unassigned";
            return (
              <MotionItem key={h.id}>
                <div className="p-6 rounded-2xl glass-panel group transition-all duration-300 border border-white/5 bg-white/[0.02] backdrop-blur-xl overflow-hidden relative break-inside-avoid">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-white/5 pb-4 mb-4">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <ClipboardList className="h-5 w-5 text-zinc-400" />
                        <span className="font-display text-lg font-medium tracking-wide text-white">
                           {formatHandoffDate(h.handoff_date)}
                        </span>
                        <span className="text-zinc-500 font-mono tracking-widest text-[10px] uppercase font-bold">
                           {h.outgoing_shift} → {h.incoming_shift}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500 font-medium pl-8">
                        Out: <span className="text-zinc-300">{outName}</span>
                        {h.incoming_staff_id ? <><span className="mx-2">·</span>In: <span className="text-zinc-300">{inName}</span></> : null}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center pr-2">
                       {h.incoming_acknowledged ? (
                         <Badge className="border-emerald-500/40 bg-emerald-500/20 text-emerald-300 uppercase tracking-widest font-mono text-[9px] font-bold rounded-full px-3 py-1 shadow-[inset_0_1px_10px_rgba(16,185,129,0.1)]">Acknowledged</Badge>
                       ) : (
                         <Badge className="border-amber-500/40 bg-amber-500/20 text-amber-300 uppercase tracking-widest font-mono text-[9px] font-bold rounded-full px-3 py-1 shadow-[inset_0_1px_10px_rgba(217,119,6,0.1)]">
                           Pending ack
                         </Badge>
                       )}
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {h.outgoing_notes?.trim() ? (
                      <div className="rounded-xl border border-white/5 bg-black/40 p-4 shadow-inner">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 font-mono mb-2">Outgoing notes</p>
                        <p className="whitespace-pre-wrap text-sm text-zinc-300 leading-relaxed font-mono">{h.outgoing_notes}</p>
                      </div>
                    ) : null}
                    {summaryLines.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 font-mono pl-1">Summary Items</p>
                        {summaryLines.map((line, idx) => (
                          <div
                            key={`${h.id}-s-${idx}`}
                            className="flex items-start gap-3 rounded-xl border border-white/5 bg-black/40 p-3 text-sm text-zinc-300 shadow-inner group-hover:border-white/10 transition-colors"
                          >
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500/80" aria-hidden />
                            <span className="font-mono leading-relaxed">{line}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {h.incoming_notes?.trim() ? (
                      <div className="rounded-xl border border-white/5 bg-black/40 p-4 shadow-inner">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 font-mono mb-2">Incoming notes</p>
                        <p className="whitespace-pre-wrap text-sm text-zinc-300 leading-relaxed font-mono">{h.incoming_notes}</p>
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
  const out: string[] = [];
  for (const [k, v] of Object.entries(summary as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) {
      out.push(`${humanizeKey(k)}: ${v.trim()}`);
    }
  }
  return out;
}

function humanizeKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatHandoffDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}
