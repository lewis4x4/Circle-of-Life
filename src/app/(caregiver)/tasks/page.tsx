"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, Loader2, UserRound } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { fetchActiveResidentsWithRooms, type ResidentWithRoom } from "@/lib/caregiver/facility-residents";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { ADL_OPTIONS, ASSIST_OPTIONS } from "@/lib/caregiver/adl-form-options";
import { fetchDailyLogIdForAdlLink } from "@/lib/caregiver/daily-log-link";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

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
      const dailyLogId = await fetchDailyLogIdForAdlLink(supabase, {
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
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Task &amp; ADL queue</CardTitle>
          <CardDescription className="text-zinc-400">
            {ctx?.facilityName ? (
              <>
                Live census at <span className="text-zinc-200">{ctx.facilityName}</span>. Log ADL passes against today&apos;s date
                in facility time.
              </>
            ) : (
              "Prioritize residents with fewer documented ADL passes today, then log each pass."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <MetricPill label="Residents in scope" value={String(metrics.residents)} tone="neutral" />
          <MetricPill label="No ADL yet today" value={String(metrics.noPass)} tone="danger" />
          <MetricPill label="ADL passes today" value={String(metrics.totalAdl)} tone="success" />
          <MetricPill label="Shift bucket" value={ctx ? currentShiftForTimezone(ctx.timeZone) : "—"} tone="neutral" />
        </CardContent>
      </Card>

      {loadError ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-100">{loadError}</div>
      ) : null}

      {sortedResidents.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardContent className="py-8 text-center text-sm text-zinc-400">
            No active residents in this facility scope. Add census in the admin console.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedResidents.map((r) => (
            <ResidentAdlCard
              key={r.id}
              resident={r}
              passesToday={adlCountByResident.get(r.id) ?? 0}
              busy={submittingId === r.id}
              onSubmit={(p) => void logAdl(r, p)}
            />
          ))}
        </div>
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
      ? "border-rose-800/60 bg-rose-950/30"
      : tone === "warning"
        ? "border-amber-800/60 bg-amber-950/30"
        : tone === "success"
          ? "border-emerald-800/60 bg-emerald-950/30"
          : "border-zinc-800 bg-zinc-900/80";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
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
      ? "border-rose-800/70 bg-rose-950/20"
      : priority === "high"
        ? "border-amber-800/70 bg-amber-950/20"
        : "border-zinc-800 bg-zinc-950/80";

  return (
    <Card className={`text-zinc-100 ${priorityClasses}`}>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="text-sm font-medium text-white">{resident.displayName}</p>
              <p className="mt-0.5 text-xs text-zinc-400">Room {resident.roomLabel}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              className={
                priority === "critical"
                  ? "border-rose-700 bg-rose-900/40 text-rose-200"
                  : priority === "high"
                    ? "border-amber-700 bg-amber-900/40 text-amber-200"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200"
              }
            >
              {priority === "critical" ? "No ADL yet" : priority === "high" ? "Light pass" : "Stable"}
            </Badge>
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
              <Clock3 className="h-3 w-3" />
              {passesToday} pass{passesToday === 1 ? "" : "es"} today
            </span>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">ADL</Label>
            <select
              className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100"
              value={adlType}
              onChange={(e) => setAdlType(e.target.value)}
            >
              {ADL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Assistance</Label>
            <select
              className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100"
              value={assistance}
              onChange={(e) => setAssistance(e.target.value as Database["public"]["Enums"]["assistance_level"])}
            >
              {ASSIST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
            checked={refused}
            onChange={(e) => setRefused(e.target.checked)}
          />
          Refused / deferred
        </label>

        <textarea
          rows={2}
          placeholder="Optional note (objective, brief)"
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <Button
          type="button"
          disabled={busy}
          className="h-10 w-full bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
          onClick={() => {
            onSubmit({ adlType, assistance, refused, notes });
            setNotes("");
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
          Log ADL pass
        </Button>
      </CardContent>
    </Card>
  );
}
