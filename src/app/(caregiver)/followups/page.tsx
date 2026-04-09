"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BellRing, ChevronRight, Clock3, Loader2 } from "lucide-react";

import { conditionChangeTypeLabel } from "@/lib/caregiver/floor-queues";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { fetchActiveResidentsWithRooms } from "@/lib/caregiver/facility-residents";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { cn } from "@/lib/utils";

type OpenCondition = {
  id: string;
  residentId: string;
  title: string;
  reportedAtLabel: string;
  priority: "high" | "medium";
  roomLabel: string;
  name: string;
};

export default function CaregiverFollowupsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OpenCondition[]>([]);

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
      const residents = await fetchActiveResidentsWithRooms(supabase, facilityId);
      const resById = new Map(residents.map((r) => [r.id, r] as const));

      const cq = await supabase
        .from("condition_changes")
        .select("id, resident_id, change_type, description, severity, reported_at")
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .is("resolved_at", null)
        .order("reported_at", { ascending: false })
        .limit(30);
      if (cq.error) throw cq.error;

      const list: OpenCondition[] = (cq.data ?? []).map((raw) => {
        const r = raw as {
          id: string;
          resident_id: string;
          change_type: string;
          description: string;
          severity: string;
          reported_at: string;
        };
        const res = resById.get(r.resident_id);
        const name = res?.displayName ?? "Resident";
        const roomLabel = res?.roomLabel ?? "—";
        const sev = (r.severity ?? "moderate").toLowerCase();
        const priority: "high" | "medium" = sev === "critical" || sev === "high" ? "high" : "medium";
        const cat = conditionChangeTypeLabel(r.change_type);
        const title = `${cat} — ${truncate(r.description, 72)}`;
        const reportedAtLabel = formatShortDateTime(r.reported_at);
        return {
          id: r.id,
          residentId: r.resident_id,
          title,
          reportedAtLabel,
          priority,
          roomLabel,
          name,
        };
      });
      setRows(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load follow-ups.");
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
        Loading follow-ups…
      </div>
    );
  }

  if (loadError) {
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
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-white/5 bg-gradient-to-br from-teal-950/40 via-slate-900/40 to-black/60 backdrop-blur-3xl shadow-2xl relative overflow-visible z-10 w-full transition-all text-zinc-100">
        <h3 className="flex items-center gap-3 text-2xl font-display font-semibold text-white tracking-wide">
          <div className="w-10 h-10 rounded-full bg-teal-500/20 flex items-center justify-center border border-teal-500/30">
            <BellRing className="h-5 w-5 text-teal-400" />
          </div>
          Condition Follow-ups
        </h3>
        <p className="text-sm font-mono text-teal-200/60 mt-4 max-w-xl">
          Open condition change reports for your facility (resolve in the clinical / nurse workflow).
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="glass-panel p-8 rounded-[2rem] border border-white/5 bg-slate-900/40 text-center backdrop-blur-xl">
          <p className="text-sm font-mono text-zinc-400">No open follow-ups right now.</p>
        </div>
      ) : (
        <MotionList className="space-y-4">
          {rows.map((r) => (
            <MotionItem key={r.id}>
              <div className="p-6 md:p-8 rounded-[2rem] glass-panel group transition-all duration-300 border border-white/5 bg-white/[0.02] backdrop-blur-xl relative overflow-hidden flex flex-col md:flex-row md:items-center gap-4">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-[50px] -mr-10 -mt-10 pointer-events-none" />
                 
                <div className="flex flex-1 flex-col gap-2 relative z-10 w-full">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-2">
                    <div className="flex items-start md:items-center gap-3">
                      <span className="text-xl font-display tracking-wide font-semibold text-white leading-tight">{r.title}</span>
                      <Badge
                        className={`rounded-full px-3 py-1 text-[9px] uppercase tracking-widest font-mono font-bold shadow-inner shrink-0 ${
                          r.priority === "high"
                            ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                            : "border-teal-500/40 bg-teal-500/20 text-teal-300"
                        }`}
                      >
                        {r.priority === "high" ? "Priority" : "Routine"}
                      </Badge>
                    </div>
                  </div>
                  
                  <p className="text-[11px] uppercase tracking-widest font-mono font-bold text-zinc-400">
                    <span className="text-zinc-200">{r.name}</span> <span className="mx-2 opacity-50">·</span> Rm {r.roomLabel}
                  </p>
                  
                  <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-white/5">
                    <p className="flex items-center gap-2 text-[11px] font-mono leading-relaxed text-amber-200/90 bg-amber-950/30 w-fit px-3 py-1.5 rounded-lg border border-amber-500/20 shadow-inner">
                      <Clock3 className="h-3.5 w-3.5" />
                      Reported {r.reportedAtLabel}
                    </p>
                  </div>
                </div>
                
                <div className="md:border-l border-white/5 md:pl-6 pt-4 md:pt-0 mt-2 md:mt-0 relative top-1 flex justify-end">
                  <Link
                    href={`/caregiver/resident/${r.residentId}/condition-change`}
                    className="w-12 h-12 rounded-full border border-white/10 bg-black/40 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors tap-responsive shadow-inner shrink-0"
                    aria-label={`Open ${r.name}`}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Link>
                </div>
              </div>
            </MotionItem>
          ))}
        </MotionList>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
