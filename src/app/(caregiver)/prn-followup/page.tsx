"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ChevronRight, Loader2, Pill } from "lucide-react";

import { getDashboardRouteForUser } from "@/lib/auth/user-home-route";
import {
  canUpdateAnyEmarRecord,
  DEFAULT_PRN_REASSESS_MINUTES,
  prnReassessmentDueAt,
} from "@/lib/caregiver/floor-queues";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { fetchActiveResidentsWithRooms } from "@/lib/caregiver/facility-residents";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { Label } from "@/components/ui/label";
import { FloorWorkflowStrip } from "@/components/caregiver/FloorWorkflowStrip";

type MedJoin = {
  medication_name: string;
  prn_effectiveness_check_minutes: number | null;
};

type EmarRow = {
  id: string;
  resident_id: string;
  actual_time: string;
  administered_by: string | null;
  resident_medications: MedJoin | MedJoin[] | null;
};

type DisplayRow = {
  id: string;
  residentId: string;
  name: string;
  room: string;
  med: string;
  givenLabel: string;
  reassessLabel: string;
  status: "overdue" | "due";
  canDocument: boolean;
  minutes: number;
};

function medFromRow(row: EmarRow): MedJoin | null {
  const m = row.resident_medications;
  if (m == null) return null;
  return Array.isArray(m) ? m[0] ?? null : m;
}

export default function CaregiverPrnFollowupPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [homeHref, setHomeHref] = useState("/caregiver");

  const [openId, setOpenId] = useState<string | null>(null);
  const [result, setResult] = useState("effective");
  const [effNotes, setEffNotes] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

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
      if (!user) {
        setLoadError("Session expired. Sign in again.");
        setLoading(false);
        return;
      }
      setHomeHref(getDashboardRouteForUser(user, "/caregiver"));
      setUserId(user.id);
      const prof = await supabase.from("user_profiles").select("app_role").eq("id", user.id).maybeSingle();
      const role = (prof.data as { app_role: string } | null)?.app_role ?? null;

      const resolved = await loadCaregiverFacilityContext(supabase);
      if (!resolved.ok) {
        setLoadError(resolved.error);
        setLoading(false);
        return;
      }
      const { facilityId } = resolved.ctx;
      const residents = await fetchActiveResidentsWithRooms(supabase, facilityId);
      const resById = new Map(residents.map((r) => [r.id, r] as const));

      const emarQ = await supabase
        .from("emar_records")
        .select(
          "id, resident_id, actual_time, administered_by, prn_effectiveness_checked, resident_medications(medication_name, prn_effectiveness_check_minutes)",
        )
        .eq("facility_id", facilityId)
        .eq("is_prn", true)
        .in("status", ["given", "self_administered"])
        .not("actual_time", "is", null)
        .is("deleted_at", null)
        .or("prn_effectiveness_checked.is.null,prn_effectiveness_checked.eq.false")
        .order("actual_time", { ascending: false })
        .limit(50);
      if (emarQ.error) throw emarQ.error;

      const now = Date.now();
      const display: DisplayRow[] = [];
      for (const raw of emarQ.data ?? []) {
        const row = raw as EmarRow;
        if ((raw as { prn_effectiveness_checked?: boolean | null }).prn_effectiveness_checked === true) continue;
        const med = medFromRow(row);
        const medName = med?.medication_name?.trim() || "PRN medication";
        const minutes =
          med?.prn_effectiveness_check_minutes != null && med.prn_effectiveness_check_minutes > 0
            ? med.prn_effectiveness_check_minutes
            : DEFAULT_PRN_REASSESS_MINUTES;
        const dueAt = prnReassessmentDueAt(row.actual_time, med?.prn_effectiveness_check_minutes ?? null);
        const overdue = now > dueAt.getTime();
        const res = resById.get(row.resident_id);
        const administeredBy = row.administered_by;
        const canDocument = canUpdateAnyEmarRecord(role) || administeredBy === user.id;
        display.push({
          id: row.id,
          residentId: row.resident_id,
          name: res?.displayName ?? "Resident",
          room: res?.roomLabel ?? "—",
          med: medName,
          givenLabel: formatShortDateTime(row.actual_time),
          reassessLabel: formatShortDateTime(dueAt.toISOString()),
          status: overdue ? "overdue" : "due",
          canDocument,
          minutes,
        });
      }
      setRows(display);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load PRN follow-ups.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveEffectiveness(emarId: string) {
    if (!userId) return;
    setSavingId(emarId);
    setLoadError(null);
    try {
      const upd = await supabase
        .from("emar_records")
        .update({
          prn_effectiveness_checked: true,
          prn_effectiveness_time: new Date().toISOString(),
          prn_effectiveness_result: result,
          prn_effectiveness_notes: effNotes.trim() || null,
          updated_by: userId,
        })
        .eq("id", emarId);
      if (upd.error) throw upd.error;
      setOpenId(null);
      setEffNotes("");
      setResult("effective");
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not save reassessment.");
    } finally {
      setSavingId(null);
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
        Loading PRN follow-ups…
      </div>
    );
  }

  if (loadError && rows.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">{loadError}</div>
        <Link
          href={homeHref}
          className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        >
          Back to shift home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <FloorWorkflowStrip
        active="prn"
        title="Close the loop after PRN administration before the shift turns over."
        description="Document effectiveness here, then move back to meds or into handoff if the resident still needs attention."
      />
      <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-white/5 bg-gradient-to-br from-violet-950/40 via-slate-900/40 to-black/60 backdrop-blur-3xl shadow-2xl relative overflow-visible z-10 w-full transition-all text-zinc-100">
        <h3 className="flex items-center gap-3 text-2xl font-display font-semibold text-white tracking-wide">
          <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center border border-violet-500/30">
            <Pill className="h-5 w-5 text-violet-400" />
          </div>
          PRN follow-up
        </h3>
        <p className="text-sm font-mono text-violet-200/60 mt-4 max-w-xl">
          PRN administrations that still need an effectiveness check (per order window, default <span className="font-bold text-white">{DEFAULT_PRN_REASSESS_MINUTES}</span> min).
        </p>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-100">{loadError}</div>
      ) : null}

      {rows.length === 0 ? (
        <div className="glass-panel p-8 rounded-[2rem] border border-white/5 bg-slate-900/40 text-center backdrop-blur-xl">
          <p className="text-sm font-mono text-zinc-400">No pending PRN reassessments.</p>
        </div>
      ) : (
        <MotionList className="space-y-4">
          {rows.map((r) => (
            <MotionItem key={r.id}>
              <div className="p-6 md:p-8 rounded-[2rem] glass-panel group transition-all duration-300 border border-white/5 bg-white/[0.02] backdrop-blur-xl relative overflow-hidden flex flex-col md:flex-row md:items-start gap-4">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-[50px] -mr-10 -mt-10 pointer-events-none" />
                 
                <div className="flex flex-1 flex-col gap-2 relative z-10 w-full">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-display tracking-wide font-semibold text-white">{r.med}</span>
                      <Badge
                        className={`rounded-full px-3 py-1 text-[9px] uppercase tracking-widest font-mono font-bold shadow-inner ${
                          r.status === "overdue"
                            ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                            : "border-amber-500/40 bg-amber-500/20 text-amber-300"
                        }`}
                      >
                        {r.status === "overdue" ? "Overdue reassess" : "Reassess pending"}
                      </Badge>
                    </div>
                  </div>
                  
                  <p className="text-[11px] uppercase tracking-widest font-mono font-bold text-zinc-400">
                    <span className="text-zinc-200">{r.name}</span> <span className="mx-2 opacity-50">·</span> Rm {r.room}
                  </p>
                  
                  <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-white/5">
                    <p className="flex items-center gap-2 text-[11px] font-mono leading-relaxed text-zinc-300 bg-black/40 w-fit px-3 py-1.5 rounded-lg border border-white/5 shadow-inner">
                      <Activity className="h-3.5 w-3.5 text-violet-400" />
                      Given {r.givenLabel} <span className="text-zinc-500 mx-1">/</span> Target by {r.reassessLabel} ({r.minutes} min)
                    </p>
                  </div>
                  
                  {!r.canDocument ? (
                    <p className="text-xs text-zinc-500 mt-2 font-mono">
                      Only the administering staff or a nurse can document effectiveness for this dose.
                    </p>
                  ) : null}
                  
                  {r.canDocument && openId === r.id ? (
                    <div className="mt-4 space-y-4 rounded-2xl border border-white/5 bg-black/40 p-5 shadow-inner">
                      <div className="space-y-2">
                        <Label className="text-[10px] font-bold uppercase tracking-widest font-mono text-zinc-500 pl-1">Effectiveness Result</Label>
                        <select
                          className="flex h-14 w-full appearance-none rounded-2xl border border-white/10 bg-black/60 px-5 text-sm text-zinc-200 font-medium font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/50 shadow-inner tap-responsive"
                          value={result}
                          onChange={(e) => setResult(e.target.value)}
                        >
                          <option value="effective">Effective</option>
                          <option value="partial">Partial</option>
                          <option value="ineffective">Ineffective</option>
                          <option value="not_assessed">Not assessed</option>
                        </select>
                      </div>
                      <textarea
                        rows={2}
                        placeholder="Optional narrative notes..."
                        className="w-full resize-none rounded-2xl border border-white/10 bg-black/60 px-5 py-4 text-sm text-zinc-200 font-medium font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/50 shadow-inner placeholder:text-zinc-600 tap-responsive"
                        value={effNotes}
                        onChange={(e) => setEffNotes(e.target.value)}
                      />
                      <div className="flex flex-wrap gap-3 pt-2">
                        <Button
                          type="button"
                          disabled={savingId === r.id}
                          className="h-12 px-8 rounded-full font-mono uppercase tracking-widest text-[10px] shadow-[0_4px_20px_rgba(139,92,246,0.15)] transition-all hover:scale-[1.02] border border-violet-500 text-white font-bold bg-violet-600 hover:bg-violet-500 tap-responsive flex-1 sm:flex-none"
                          onClick={() => void saveEffectiveness(r.id)}
                        >
                          {savingId === r.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Save Result
                        </Button>
                        <Button type="button" className="h-12 px-6 rounded-full font-mono uppercase tracking-widest text-[10px] font-bold bg-black/40 hover:bg-white/10 text-zinc-300 border border-white/10 flex-1 sm:flex-none tap-responsive" onClick={() => setOpenId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  
                  {r.canDocument && openId !== r.id ? (
                    <Button
                      type="button"
                      className="mt-3 w-fit h-12 px-6 rounded-full font-mono uppercase tracking-widest text-[10px] font-bold bg-black/40 hover:bg-white/10 text-zinc-300 border border-white/10 tap-responsive shadow-inner"
                      onClick={() => {
                        setOpenId(r.id);
                        setResult("effective");
                        setEffNotes("");
                      }}
                    >
                      Document Reassessment
                    </Button>
                  ) : null}
                </div>
                
                <div className="md:border-l border-white/5 md:pl-6 pt-4 md:pt-0 mt-2 md:mt-0 relative top-1 flex justify-end">
                   <Link
                     href={`/caregiver/meds`}
                     className="w-12 h-12 rounded-full border border-white/10 bg-black/40 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors tap-responsive shadow-inner"
                     aria-label="Open eMAR"
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
