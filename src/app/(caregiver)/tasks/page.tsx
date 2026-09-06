"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { fetchActiveResidentsWithRooms, type ResidentWithRoom } from "@/lib/caregiver/facility-residents";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { formatCaregiverTasksShiftBucket } from "@/lib/caregiver/tasks-display-copy";
import { fetchShiftDailyLogId } from "@/lib/caregiver/daily-log-link";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { getDashboardRouteForUser } from "@/lib/auth/user-home-route";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { ResidentAdlCard } from "@/components/caregiver/ResidentAdlCard";
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
      return a.displayName.localeCompare(b.displayName);
    });
  }, [residents]);

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
    if (!ctx || submittingId) return false;
    if (payload.refused && !payload.notes.trim()) { setLoadError("Document the resident's reason for declining care or the observed circumstances."); return false; }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Session expired. Sign in again.");
      return false;
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
        refusal_reason: payload.refused ? payload.notes.trim() : null,
        notes: payload.notes.trim() || null,
        detail_data: {},
      };
      const ins = await supabase.from("adl_logs").insert(row).select("id").single();
      if (ins.error) throw ins.error;
      setAdlCountByResident((counts) => new Map(counts).set(resident.id, (counts.get(resident.id) ?? 0) + 1));
      return true;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not log ADL.");
      return false;
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
          href={homeHref}
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
      <div className="p-6 sm:p-8 rounded-lg border border-white/5 shadow-2xl relative overflow-visible z-10 w-full transition-all text-zinc-100">
        <div className="mb-6">
          <h3 className="text-2xl font-semibold text-white tracking-wide">Task &amp; ADL queue</h3>
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
          <MetricPill label="Residents in scope" value={String(metrics.residents)} tone="muted" />
          <MetricPill label="No ADL yet today" value={String(metrics.noPass)} tone="danger" />
          <MetricPill label="ADL entries today" value={String(metrics.totalAdl)} tone="success" />
          <MetricPill label="Shift bucket" value={formatCaregiverTasksShiftBucket(ctx?.timeZone)} tone="muted" />
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-100">{loadError}</div>
      ) : null}

      {sortedResidents.length === 0 ? (
        <div className="p-8 rounded-2xl border border-white/5 bg-slate-900/40 text-center">
          <p className="text-sm font-mono text-zinc-400">No active residents in this facility scope. Add census in the admin console.</p>
        </div>
      ) : (
        <MotionList className="space-y-3">
          {sortedResidents.map((r) => (
            <MotionItem key={r.id}>
              <ResidentAdlCard
                resident={r}
                passesToday={adlCountByResident.get(r.id) ?? 0}
                busy={submittingId !== null}
                onSubmit={(p) => logAdl(r, p)}
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
  tone: "muted" | "warning" | "danger" | "success";
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
    <div className={`rounded-xl border p-4  ${toneClass}`}>
      <p className="text-[9px] uppercase tracking-wider font-mono text-zinc-400">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
