"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Brain, Loader2, PlusCircle } from "lucide-react";

import { fetchShiftDailyLogId } from "@/lib/caregiver/daily-log-link";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const BEHAVIOR_TYPES: { value: string; label: string }[] = [
  { value: "agitation", label: "Agitation / anxiety" },
  { value: "wandering", label: "Wandering / elopement risk" },
  { value: "verbal", label: "Verbal outburst" },
  { value: "physical", label: "Physical aggression" },
  { value: "self_injury", label: "Self-injury / SIB" },
  { value: "withdrawal", label: "Withdrawal / refusal" },
  { value: "sundowning", label: "Sundowning" },
  { value: "other", label: "Other" },
];

type BehaviorRow = Pick<
  Database["public"]["Tables"]["behavioral_logs"]["Row"],
  "id" | "occurred_at" | "shift" | "behavior_type" | "behavior" | "antecedent" | "consequence" | "notes" | "injury_occurred"
>;

export default function CaregiverResidentBehaviorPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const supabase = useMemo(() => createClient(), []);

  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<{
    facilityId: string;
    organizationId: string;
    timeZone: string;
  } | null>(null);
  const [residentLabel, setResidentLabel] = useState<string | null>(null);
  const [rows, setRows] = useState<BehaviorRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [behaviorType, setBehaviorType] = useState("agitation");
  const [behavior, setBehavior] = useState("");
  const [antecedent, setAntecedent] = useState("");
  const [consequence, setConsequence] = useState("");
  const [interventionsText, setInterventionsText] = useState("");
  const [interventionEffective, setInterventionEffective] = useState<"" | "yes" | "no">("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [injuryOccurred, setInjuryOccurred] = useState(false);
  const [injuryDetails, setInjuryDetails] = useState("");

  const idOk = isValidFacilityIdForQuery(residentId);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!idOk) {
      setLoading(false);
      return;
    }
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
      setCtx({
        facilityId: c.facilityId,
        organizationId: c.organizationId,
        timeZone: c.timeZone,
      });

      const resQ = await supabase
        .from("residents")
        .select("id, facility_id, first_name, last_name, preferred_name")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle();
      if (resQ.error) throw resQ.error;
      const resRow = resQ.data as
        | {
            id: string;
            facility_id: string;
            first_name: string;
            last_name: string;
            preferred_name: string | null;
          }
        | null;
      if (!resRow || resRow.facility_id !== c.facilityId) {
        setLoadError("This resident is not in your current facility scope.");
        setResidentLabel(null);
        setRows([]);
        setLoading(false);
        return;
      }
      const display =
        resRow.preferred_name?.trim() ||
        [resRow.first_name, resRow.last_name].filter(Boolean).join(" ").trim() ||
        "Resident";
      setResidentLabel(display);

      const bh = await supabase
        .from("behavioral_logs")
        .select("id, occurred_at, shift, behavior_type, behavior, antecedent, consequence, notes, injury_occurred")
        .eq("resident_id", residentId)
        .eq("facility_id", c.facilityId)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(15);
      if (bh.error) throw bh.error;
      setRows((bh.data ?? []) as BehaviorRow[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load behavior log.");
      setResidentLabel(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId, idOk]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitBehavior() {
    if (!ctx || !idOk || !behavior.trim()) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Session expired. Sign in again.");
      return;
    }
    setSubmitting(true);
    setLoadError(null);
    try {
      const ymd = zonedYmd(new Date(), ctx.timeZone);
      const shift = currentShiftForTimezone(ctx.timeZone);
      const dailyLogId = await fetchShiftDailyLogId(supabase, {
        residentId,
        facilityId: ctx.facilityId,
        logDate: ymd,
        shift,
        loggedBy: user.id,
      });
      const interventions = interventionsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const dm = durationMinutes.trim() ? Number.parseInt(durationMinutes, 10) : NaN;
      const row: Database["public"]["Tables"]["behavioral_logs"]["Insert"] = {
        resident_id: residentId,
        facility_id: ctx.facilityId,
        organization_id: ctx.organizationId,
        daily_log_id: dailyLogId,
        shift,
        logged_by: user.id,
        behavior: behavior.trim(),
        behavior_type: behaviorType,
        antecedent: antecedent.trim() || null,
        consequence: consequence.trim() || null,
        notes: notes.trim() || null,
        intervention_used: interventions.length ? interventions : null,
        intervention_effective:
          interventionEffective === "" ? null : interventionEffective === "yes" ? true : false,
        duration_minutes: Number.isFinite(dm) && dm >= 0 ? dm : null,
        injury_occurred: injuryOccurred,
        injury_details: injuryOccurred && injuryDetails.trim() ? injuryDetails.trim() : null,
        physician_notified: false,
        family_notified: false,
      };
      const ins = await supabase.from("behavioral_logs").insert(row);
      if (ins.error) throw ins.error;
      setBehavior("");
      setAntecedent("");
      setConsequence("");
      setInterventionsText("");
      setInterventionEffective("");
      setDurationMinutes("");
      setNotes("");
      setInjuryOccurred(false);
      setInjuryDetails("");
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not save behavior entry.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!idOk) {
    return (
      <div className="space-y-4">
        <Link
          href="/caregiver"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-zinc-400 hover:text-white")}
        >
          <ArrowLeft className="h-4 w-4" />
          Shift home
        </Link>
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          Invalid resident identifier.
        </div>
      </div>
    );
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
        Loading behavior log…
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
      <Link
        href={`/caregiver/resident/${residentId}`}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-zinc-400 hover:text-white")}
      >
        <ArrowLeft className="h-4 w-4" />
        Resident
      </Link>

      {loadError ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-100">{loadError}</div>
      ) : null}

      <Card className="border-zinc-800 bg-zinc-950/80 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display">
            <Brain className="h-5 w-5 text-violet-400" />
            Behavior support
          </CardTitle>
          <CardDescription className="text-zinc-400">
            {residentLabel ? (
              <>
                Document observable behaviors for <span className="text-zinc-200">{residentLabel}</span>
                {ctx ? (
                  <>
                    {" "}
                    · shift <span className="text-zinc-200">{currentShiftForTimezone(ctx.timeZone)}</span>
                  </>
                ) : null}
              </>
            ) : (
              "Log behavioral events for this resident."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ctx && residentLabel ? (
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Behavior type</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100"
                    value={behaviorType}
                    onChange={(e) => setBehaviorType(e.target.value)}
                  >
                    {BEHAVIOR_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Duration (minutes)</Label>
                  <input
                    type="number"
                    min={0}
                    placeholder="Optional"
                    className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-zinc-400">What was observed</Label>
                <textarea
                  rows={3}
                  required
                  placeholder="Objective description"
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
                  value={behavior}
                  onChange={(e) => setBehavior(e.target.value)}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Antecedent (optional)</Label>
                  <textarea
                    rows={2}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                    value={antecedent}
                    onChange={(e) => setAntecedent(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Consequence / outcome (optional)</Label>
                  <textarea
                    rows={2}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                    value={consequence}
                    onChange={(e) => setConsequence(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-zinc-400">Interventions used (comma-separated)</Label>
                <input
                  type="text"
                  placeholder="e.g. redirection, music, 1:1 sitter"
                  className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100"
                  value={interventionsText}
                  onChange={(e) => setInterventionsText(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-zinc-400">Intervention effective?</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100"
                  value={interventionEffective}
                  onChange={(e) => setInterventionEffective(e.target.value as "" | "yes" | "no")}
                >
                  <option value="">Not recorded</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-zinc-400">Additional notes</Label>
                <textarea
                  rows={2}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
                  checked={injuryOccurred}
                  onChange={(e) => setInjuryOccurred(e.target.checked)}
                />
                Injury occurred
              </label>
              {injuryOccurred ? (
                <textarea
                  rows={2}
                  placeholder="Injury details"
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                  value={injuryDetails}
                  onChange={(e) => setInjuryDetails(e.target.value)}
                />
              ) : null}
              <Button
                type="button"
                disabled={submitting || !behavior.trim()}
                className="h-10 w-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
                onClick={() => void submitBehavior()}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlusCircle className="mr-1.5 h-4 w-4" />
                )}
                Log behavior event
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Recent entries</p>
            {rows.length === 0 ? (
              <p className="text-sm text-zinc-400">No behavioral events logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
                    <p className="font-medium capitalize text-zinc-100">
                      {BEHAVIOR_TYPES.find((b) => b.value === row.behavior_type)?.label ?? row.behavior_type}
                    </p>
                    <p className="mt-1 text-zinc-300">{row.behavior}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {new Date(row.occurred_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {row.shift}
                    </p>
                    {row.antecedent ? <p className="mt-1 text-xs text-zinc-400">Before: {row.antecedent}</p> : null}
                    {row.consequence ? <p className="text-xs text-zinc-400">After: {row.consequence}</p> : null}
                    {row.injury_occurred ? <p className="text-xs text-rose-400">Injury documented</p> : null}
                    {row.notes?.trim() ? <p className="mt-1 text-xs text-zinc-400">{row.notes}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
