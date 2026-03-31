"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Loader2, MessageSquare } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display">
            <MessageSquare className="h-5 w-5 text-teal-400" />
            Shift handoff
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Recent recorded handoffs for your facility (read-only). Create or edit handoffs from the nurse lead workflow when
            enabled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="outline" className="border-teal-800/60 bg-teal-950/30 text-teal-200">
            Latest {rows.length ? `${rows.length}` : "0"} record{rows.length === 1 ? "" : "s"}
          </Badge>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardContent className="py-8 text-center text-sm text-zinc-400">No shift handoffs on file yet.</CardContent>
        </Card>
      ) : (
        rows.map((h) => {
          const summaryLines = autoSummaryLines(h.auto_summary);
          const outName = nameById.get(h.outgoing_staff_id) ?? "Staff";
          const inName = h.incoming_staff_id ? (nameById.get(h.incoming_staff_id) ?? "Staff") : "Unassigned";
          return (
            <Card key={h.id} className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <ClipboardList className="h-4 w-4 text-zinc-400" />
                  {formatHandoffDate(h.handoff_date)} · {h.outgoing_shift} → {h.incoming_shift}
                  {h.incoming_acknowledged ? (
                    <Badge className="border-emerald-800/60 bg-emerald-950/40 text-emerald-200">Acknowledged</Badge>
                  ) : (
                    <Badge variant="outline" className="border-zinc-600 text-zinc-300">
                      Pending ack
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs text-zinc-500">
                  Outgoing: {outName}
                  {h.incoming_staff_id ? ` · Incoming: ${inName}` : null}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {h.outgoing_notes?.trim() ? (
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3 text-sm text-zinc-200">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Outgoing notes</p>
                    <p className="mt-1 whitespace-pre-wrap">{h.outgoing_notes}</p>
                  </div>
                ) : null}
                {summaryLines.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Summary</p>
                    {summaryLines.map((line, idx) => (
                      <div
                        key={`${h.id}-s-${idx}`}
                        className="flex items-start gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3 text-sm text-zinc-200"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500/80" aria-hidden />
                        {line}
                      </div>
                    ))}
                  </div>
                ) : null}
                {h.incoming_notes?.trim() ? (
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3 text-sm text-zinc-200">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Incoming notes</p>
                    <p className="mt-1 whitespace-pre-wrap">{h.incoming_notes}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })
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
