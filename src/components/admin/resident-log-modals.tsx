"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Stethoscope, FileText, CheckCircle2, Loader2 } from "lucide-react";

import { fetchShiftDailyLogId } from "@/lib/caregiver/daily-log-link";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { requestEvaluateVitals } from "@/lib/infection-control/request-evaluate-vitals";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// ============================================================================
// BEHAVIOR LOG MODAL
// ============================================================================

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

export function BehaviorLogModal({
  open,
  onOpenChange,
  residentId,
  residentName,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  residentName: string;
  onSuccess?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ctx, setCtx] = useState<{
    facilityId: string;
    organizationId: string;
    timeZone: string;
  } | null>(null);
  const [rows, setRows] = useState<BehaviorRow[]>([]);

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

  const load = useCallback(async () => {
    if (!ctx) return;
    const bh = await supabase
      .from("behavioral_logs")
      .select("id, occurred_at, shift, behavior_type, behavior, antecedent, consequence, notes, injury_occurred")
      .eq("resident_id", residentId)
      .eq("facility_id", ctx.facilityId)
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false })
      .limit(5);
    if (bh.error) {
      console.warn("[behavior modal] load error:", bh.error.message);
    } else {
      setRows((bh.data ?? []) as BehaviorRow[]);
    }
  }, [supabase, residentId, ctx]);

  const initContext = useCallback(async () => {
    const resolved = await loadCaregiverFacilityContext(supabase);
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }
    setCtx({
      facilityId: resolved.ctx.facilityId,
      organizationId: resolved.ctx.organizationId,
      timeZone: resolved.ctx.timeZone,
    });
  }, [supabase]);

  useEffect(() => {
    if (open) {
      setError(null);
      setSuccess(false);
      initContext();
    }
  }, [open, initContext]);

  useEffect(() => {
    if (ctx) {
      load();
    }
  }, [ctx, load]);

  async function submitBehavior() {
    if (!ctx || !behavior.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Session expired. Sign in again.");
      return;
    }
    setSubmitting(true);
    setError(null);
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
        behavior_type: behaviorType as never,
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
      setSuccess(true);
      onSuccess?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save behavior entry.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setBehavior("");
    setAntecedent("");
    setConsequence("");
    setInterventionsText("");
    setInterventionEffective("");
    setDurationMinutes("");
    setNotes("");
    setInjuryOccurred(false);
    setInjuryDetails("");
    setSuccess(false);
    setError(null);
  }

  function handleResetAndClose() {
    resetForm();
    onOpenChange(false);
  }

  if (error && !ctx) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-rose-400">Error</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-300">{error}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto border-violet-900/50 bg-gradient-to-br from-violet-950/95 via-zinc-950 to-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-display text-violet-200">
            <Brain className="h-5 w-5 text-violet-400" />
            Log Behavior Event
          </DialogTitle>
          <DialogDescription className="text-violet-200/70">
            Document observable behaviors for <span className="text-violet-100 font-medium">{residentName}</span>
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-500/40">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <p className="text-lg font-display text-emerald-300">Behavior logged successfully</p>
            <div className="flex gap-3 w-full">
              <Button
                type="button"
                onClick={resetForm}
                className="flex-1 bg-violet-600 text-white hover:bg-violet-500"
              >
                Log Another
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleResetAndClose}
                className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {error && (
              <div className="rounded-lg border border-rose-900/50 bg-rose-950/30 px-4 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}

            {ctx ? (
              <div className="space-y-4 rounded-xl border border-violet-900/35 bg-black/25 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-violet-200/80">Behavior type</Label>
                    <select
                      className="flex h-11 w-full rounded-lg border border-violet-900/50 bg-zinc-950 px-3 text-sm text-zinc-100 focus:ring-2 focus:ring-violet-500/50"
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
                  <div className="space-y-2">
                    <Label className="text-xs text-violet-200/80">Duration (minutes)</Label>
                    <input
                      type="number"
                      min={0}
                      placeholder="Optional"
                      className="flex h-11 w-full rounded-lg border border-violet-900/50 bg-zinc-950 px-3 text-sm text-zinc-100 focus:ring-2 focus:ring-violet-500/50"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-violet-200/80">What was observed <span className="text-rose-400">*</span></Label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Objective description of the behavior..."
                    className="w-full rounded-lg border border-violet-900/50 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:ring-violet-500/50"
                    value={behavior}
                    onChange={(e) => setBehavior(e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-violet-200/80">Antecedent (optional)</Label>
                    <textarea
                      rows={2}
                      placeholder="What happened before..."
                      className="w-full rounded-lg border border-violet-900/50 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:ring-violet-500/50"
                      value={antecedent}
                      onChange={(e) => setAntecedent(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-violet-200/80">Consequence / outcome (optional)</Label>
                    <textarea
                      rows={2}
                      placeholder="What happened after..."
                      className="w-full rounded-lg border border-violet-900/50 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:ring-violet-500/50"
                      value={consequence}
                      onChange={(e) => setConsequence(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-violet-200/80">Interventions used (comma-separated)</Label>
                  <input
                    type="text"
                    placeholder="e.g. redirection, music, 1:1 sitter"
                    className="flex h-11 w-full rounded-lg border border-violet-900/50 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:ring-violet-500/50"
                    value={interventionsText}
                    onChange={(e) => setInterventionsText(e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-violet-200/80">Intervention effective?</Label>
                    <select
                      className="flex h-11 w-full rounded-lg border border-violet-900/50 bg-zinc-950 px-3 text-sm text-zinc-100 focus:ring-2 focus:ring-violet-500/50"
                      value={interventionEffective}
                      onChange={(e) => setInterventionEffective(e.target.value as "" | "yes" | "no")}
                    >
                      <option value="">Not recorded</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-violet-200/80">Additional notes</Label>
                    <textarea
                      rows={1}
                      className="w-full rounded-lg border border-violet-900/50 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:ring-violet-500/50"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-violet-100/90 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-violet-800 bg-zinc-950"
                    checked={injuryOccurred}
                    onChange={(e) => setInjuryOccurred(e.target.checked)}
                  />
                  Injury occurred
                </label>
                {injuryOccurred && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                    <Label className="text-xs text-rose-300/80">Injury details</Label>
                    <textarea
                      rows={2}
                      placeholder="Describe the injury..."
                      className="w-full rounded-lg border border-rose-900/50 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:ring-rose-500/50"
                      value={injuryDetails}
                      onChange={(e) => setInjuryDetails(e.target.value)}
                    />
                  </div>
                )}
                <Button
                  type="button"
                  disabled={submitting || !behavior.trim()}
                  className="h-12 w-full bg-gradient-to-r from-violet-600 to-violet-500 text-white hover:from-violet-500 hover:to-violet-400 disabled:opacity-50 shadow-lg shadow-violet-500/20 font-medium"
                  onClick={() => void submitBehavior()}
                >
                  {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Brain className="mr-2 h-5 w-5" />}
                  Log Behavior Event
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
              </div>
            )}

            {rows.length > 0 && !success && (
              <div className="space-y-3 border-t border-violet-900/30 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-violet-200/50">Recent entries</p>
                <ul className="space-y-2">
                  {rows.map((row) => (
                    <li key={row.id} className="rounded-lg border border-violet-900/30 bg-black/20 p-3 text-sm">
                      <p className="font-medium capitalize text-violet-100">
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
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// CONDITION LOG MODAL
// ============================================================================

const CHANGE_TYPES: { value: string; label: string }[] = [
  { value: "vitals", label: "Vitals / measurements" },
  { value: "pain", label: "Pain" },
  { value: "respiratory", label: "Respiratory" },
  { value: "skin_wound", label: "Skin / wound" },
  { value: "mental_status", label: "Mental status / cognition" },
  { value: "gi", label: "GI / appetite" },
  { value: "urinary", label: "Urinary" },
  { value: "neurologic", label: "Neurologic" },
  { value: "other", label: "Other" },
];

const SEVERITIES: { value: string; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical — immediate attention" },
];

type ConditionRow = Pick<
  Database["public"]["Tables"]["condition_changes"]["Row"],
  "id" | "reported_at" | "shift" | "change_type" | "description" | "severity" | "nurse_notified"
>;

export function ConditionLogModal({
  open,
  onOpenChange,
  residentId,
  residentName,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  residentName: string;
  onSuccess?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ctx, setCtx] = useState<{
    facilityId: string;
    organizationId: string;
    timeZone: string;
  } | null>(null);
  const [rows, setRows] = useState<ConditionRow[]>([]);

  const [changeType, setChangeType] = useState("other");
  const [severity, setSeverity] = useState("moderate");
  const [description, setDescription] = useState("");
  const [nurseNotified, setNurseNotified] = useState(false);

  const load = useCallback(async () => {
    if (!ctx) return;
    const cq = await supabase
      .from("condition_changes")
      .select("id, reported_at, shift, change_type, description, severity, nurse_notified")
      .eq("resident_id", residentId)
      .eq("facility_id", ctx.facilityId)
      .is("deleted_at", null)
      .order("reported_at", { ascending: false })
      .limit(5);
    if (cq.error) {
      console.warn("[condition modal] load error:", cq.error.message);
    } else {
      setRows((cq.data ?? []) as ConditionRow[]);
    }
  }, [supabase, residentId, ctx]);

  const initContext = useCallback(async () => {
    const resolved = await loadCaregiverFacilityContext(supabase);
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }
    setCtx({
      facilityId: resolved.ctx.facilityId,
      organizationId: resolved.ctx.organizationId,
      timeZone: resolved.ctx.timeZone,
    });
  }, [supabase]);

  useEffect(() => {
    if (open) {
      setError(null);
      setSuccess(false);
      initContext();
    }
  }, [open, initContext]);

  useEffect(() => {
    if (ctx) {
      load();
    }
  }, [ctx, load]);

  async function submitReport() {
    if (!ctx || !description.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Session expired. Sign in again.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const shift = currentShiftForTimezone(ctx.timeZone);
      const nowIso = new Date().toISOString();
      const row: Database["public"]["Tables"]["condition_changes"]["Insert"] = {
        resident_id: residentId,
        facility_id: ctx.facilityId,
        organization_id: ctx.organizationId,
        shift,
        reported_by: user.id,
        reported_at: nowIso,
        change_type: changeType as never,
        description: description.trim(),
        severity,
        nurse_notified: nurseNotified,
        nurse_notified_at: nurseNotified ? nowIso : null,
        nurse_notified_by: nurseNotified ? user.id : null,
        physician_notified: false,
        family_notified: false,
        care_plan_review_triggered: false,
      };
      const ins = await supabase.from("condition_changes").insert(row);
      if (ins.error) throw ins.error;
      setSuccess(true);
      onSuccess?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit condition report.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setDescription("");
    setNurseNotified(false);
    setSuccess(false);
    setError(null);
  }

  function handleResetAndClose() {
    resetForm();
    onOpenChange(false);
  }

  if (error && !ctx) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-rose-400">Error</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-300">{error}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto border-rose-900/50 bg-gradient-to-br from-rose-950/95 via-zinc-950 to-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-display text-rose-200">
            <Stethoscope className="h-5 w-5 text-rose-400" />
            Log Condition Change
          </DialogTitle>
          <DialogDescription className="text-rose-200/70">
            Report new or worsening symptoms for <span className="text-rose-100 font-medium">{residentName}</span>. For emergencies, use your facility escalation protocol.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-500/40">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <p className="text-lg font-display text-emerald-300">Condition report submitted</p>
            <div className="flex gap-3 w-full">
              <Button
                type="button"
                onClick={resetForm}
                className="flex-1 bg-rose-700 text-white hover:bg-rose-600"
              >
                Log Another
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleResetAndClose}
                className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {error && (
              <div className="rounded-lg border border-rose-900/50 bg-rose-950/30 px-4 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}

            {ctx ? (
              <div className="space-y-4 rounded-xl border border-rose-900/35 bg-black/25 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-rose-200/80">Category</Label>
                    <select
                      className="flex h-11 w-full rounded-lg border border-rose-900/50 bg-zinc-950 px-3 text-sm text-zinc-100 focus:ring-2 focus:ring-rose-500/50"
                      value={changeType}
                      onChange={(e) => setChangeType(e.target.value)}
                    >
                      {CHANGE_TYPES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-rose-200/80">Severity</Label>
                    <select
                      className="flex h-11 w-full rounded-lg border border-rose-900/50 bg-zinc-950 px-3 text-sm text-zinc-100 focus:ring-2 focus:ring-rose-500/50"
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value)}
                    >
                      {SEVERITIES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-rose-200/80">Description <span className="text-rose-400">*</span></Label>
                  <textarea
                    rows={4}
                    required
                    placeholder="Objective findings, vitals if taken, what changed and when…"
                    className="w-full rounded-lg border border-rose-900/50 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:ring-rose-500/50"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-rose-100/90 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-rose-800 bg-zinc-950"
                    checked={nurseNotified}
                    onChange={(e) => setNurseNotified(e.target.checked)}
                  />
                  Nurse has been notified (timestamps recorded)
                </label>
                <Button
                  type="button"
                  disabled={submitting || !description.trim()}
                  className="h-12 w-full bg-gradient-to-r from-rose-700 to-rose-600 text-white hover:from-rose-600 hover:to-rose-500 disabled:opacity-50 shadow-lg shadow-rose-500/20 font-medium"
                  onClick={() => void submitReport()}
                >
                  {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Stethoscope className="mr-2 h-5 w-5" />}
                  Submit Condition Report
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-rose-400" />
              </div>
            )}

            {rows.length > 0 && !success && (
              <div className="space-y-3 border-t border-rose-900/30 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-rose-200/50">Recent reports</p>
                <ul className="space-y-2">
                  {rows.map((row) => (
                    <li key={row.id} className="rounded-lg border border-rose-900/30 bg-black/20 p-3 text-sm">
                      <p className="font-medium text-rose-100">
                        {CHANGE_TYPES.find((c) => c.value === row.change_type)?.label ?? row.change_type}
                        <span className="font-normal text-zinc-500"> · </span>
                        <span className="capitalize text-zinc-300">{row.severity}</span>
                      </p>
                      <p className="mt-1 text-zinc-200">{row.description}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {new Date(row.reported_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {row.shift}
                        {row.nurse_notified && <span className="text-emerald-400 ml-2">· nurse notified</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// GENERAL NOTE MODAL
// ============================================================================

type DailyRow = Pick<Database["public"]["Tables"]["daily_logs"]["Row"], "id" | "log_date" | "shift" | "general_notes" | "logged_by">;

function zonedTimeShort(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export function GeneralNoteModal({
  open,
  onOpenChange,
  residentId,
  residentName,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  residentName: string;
  onSuccess?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [savingNote, setSavingNote] = useState(false);
  const [savingVitals, setSavingVitals] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ctx, setCtx] = useState<{
    facilityId: string;
    organizationId: string;
    facilityName: string | null;
    timeZone: string;
  } | null>(null);
  const [dailyHistory, setDailyHistory] = useState<DailyRow[]>([]);

  const [noteDraft, setNoteDraft] = useState("");
  const [temp, setTemp] = useState("");
  const [bpSys, setBpSys] = useState("");
  const [bpDia, setBpDia] = useState("");
  const [pulse, setPulse] = useState("");

  const load = useCallback(async () => {
    if (!ctx) return;
    const dailyQ = await supabase
      .from("daily_logs")
      .select("id, log_date, shift, general_notes, logged_by")
      .eq("resident_id", residentId)
      .eq("facility_id", ctx.facilityId)
      .is("deleted_at", null)
      .order("log_date", { ascending: false })
      .limit(5);
    if (dailyQ.error) {
      console.warn("[note modal] daily load error:", dailyQ.error.message);
    } else {
      setDailyHistory((dailyQ.data ?? []) as DailyRow[]);
    }
  }, [supabase, residentId, ctx]);

  const initContext = useCallback(async () => {
    const resolved = await loadCaregiverFacilityContext(supabase);
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }
    setCtx({
      facilityId: resolved.ctx.facilityId,
      organizationId: resolved.ctx.organizationId,
      facilityName: resolved.ctx.facilityName,
      timeZone: resolved.ctx.timeZone,
    });
  }, [supabase]);

  useEffect(() => {
    if (open) {
      setError(null);
      setSuccess(false);
      initContext();
    }
  }, [open, initContext]);

  useEffect(() => {
    if (ctx) {
      load();
    }
  }, [ctx, load]);

  async function appendShiftNote() {
    if (!ctx || !noteDraft.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Session expired. Sign in again.");
      return;
    }
    setSavingNote(true);
    setError(null);
    try {
      const ymd = zonedYmd(new Date(), ctx.timeZone);
      const shift = currentShiftForTimezone(ctx.timeZone);
      const stamp = zonedTimeShort(new Date(), ctx.timeZone);
      const line = `[${stamp}] ${noteDraft.trim()}`;

      const existing = await supabase
        .from("daily_logs")
        .select("id, general_notes")
        .eq("resident_id", residentId)
        .eq("facility_id", ctx.facilityId)
        .eq("log_date", ymd)
        .eq("shift", shift)
        .eq("logged_by", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (existing.error) throw existing.error;

      if (existing.data) {
        const prev = existing.data.general_notes?.trim() ?? "";
        const next = prev ? `${prev}\n${line}` : line;
        const upd = await supabase
          .from("daily_logs")
          .update({ general_notes: next, updated_by: user.id })
          .eq("id", existing.data.id);
        if (upd.error) throw upd.error;
      } else {
        const ins: Database["public"]["Tables"]["daily_logs"]["Insert"] = {
          resident_id: residentId,
          facility_id: ctx.facilityId,
          organization_id: ctx.organizationId,
          log_date: ymd,
          shift,
          logged_by: user.id,
          general_notes: line,
        };
        const insQ = await supabase.from("daily_logs").insert(ins);
        if (insQ.error) throw insQ.error;
      }
      setNoteDraft("");
      setSuccess(true);
      onSuccess?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save shift note.");
    } finally {
      setSavingNote(false);
    }
  }

  async function saveVitals() {
    if (!ctx) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Session expired.");
      return;
    }
    setSavingVitals(true);
    setError(null);
    try {
      const ymd = zonedYmd(new Date(), ctx.timeZone);
      const shift = currentShiftForTimezone(ctx.timeZone);
      let dailyLogId = await fetchShiftDailyLogId(supabase, {
        residentId,
        facilityId: ctx.facilityId,
        logDate: ymd,
        shift,
        loggedBy: user.id,
      });
      if (!dailyLogId) {
        const ins: Database["public"]["Tables"]["daily_logs"]["Insert"] = {
          resident_id: residentId,
          facility_id: ctx.facilityId,
          organization_id: ctx.organizationId,
          log_date: ymd,
          shift,
          logged_by: user.id,
        };
        const insQ = await supabase.from("daily_logs").insert(ins).select("id").single();
        if (insQ.error) throw insQ.error;
        dailyLogId = insQ.data.id;
      }
      const t = temp.trim() ? Number.parseFloat(temp) : null;
      const ps = bpSys.trim() ? Number.parseInt(bpSys, 10) : null;
      const pd = bpDia.trim() ? Number.parseInt(bpDia, 10) : null;
      const pl = pulse.trim() ? Number.parseInt(pulse, 10) : null;
      const upd = await supabase
        .from("daily_logs")
        .update({
          temperature: t,
          blood_pressure_systolic: ps,
          blood_pressure_diastolic: pd,
          pulse: pl,
          updated_by: user.id,
        })
        .eq("id", dailyLogId);
      if (upd.error) throw upd.error;
      const ev = await requestEvaluateVitals(dailyLogId);
      if (!ev.ok) {
        setError(ev.error ?? "Vital alert evaluation failed");
      }
      setSuccess(true);
      onSuccess?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save vitals.");
    } finally {
      setSavingVitals(false);
    }
  }

  function resetForm() {
    setNoteDraft("");
    setTemp("");
    setBpSys("");
    setBpDia("");
    setPulse("");
    setSuccess(false);
    setError(null);
  }

  function handleResetAndClose() {
    resetForm();
    onOpenChange(false);
  }

  if (error && !ctx) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-rose-400">Error</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-300">{error}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto border-teal-900/50 bg-gradient-to-br from-teal-950/95 via-zinc-950 to-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-display text-teal-200">
            <FileText className="h-5 w-5 text-teal-400" />
            Shift Log
          </DialogTitle>
          <DialogDescription className="text-teal-200/70">
            Add narrative notes and vitals for <span className="text-teal-100 font-medium">{residentName}</span>
            {ctx ? (
              <>
                {" "}
                · today ({zonedYmd(new Date(), ctx.timeZone)}) · shift{" "}
                <span className="text-teal-100">{currentShiftForTimezone(ctx.timeZone)}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-500/40">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <p className="text-lg font-display text-emerald-300">Saved successfully</p>
            <div className="flex gap-3 w-full">
              <Button
                type="button"
                onClick={resetForm}
                className="flex-1 bg-teal-600 text-white hover:bg-teal-500"
              >
                Add Another
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleResetAndClose}
                className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {error && (
              <div className="rounded-lg border border-rose-900/50 bg-rose-950/30 px-4 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}

            {ctx ? (
              <div className="space-y-4 rounded-xl border border-teal-900/35 bg-black/25 p-4">
                <div className="space-y-2">
                  <Label className="text-xs text-teal-200/80">Add shift note</Label>
                  <textarea
                    rows={3}
                    placeholder="Objective, brief narrative for this pass…"
                    className="w-full rounded-lg border border-teal-900/50 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:ring-teal-500/50"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                  />
                  <Button
                    type="button"
                    disabled={savingNote || !noteDraft.trim()}
                    className="h-10 w-full bg-teal-600 text-white hover:bg-teal-500 disabled:opacity-50"
                    onClick={() => void appendShiftNote()}
                  >
                    {savingNote ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                    Save to daily log
                  </Button>
                </div>

                <div className="space-y-3 border-t border-teal-900/30 pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-teal-200/50">Vitals (optional)</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <Label className="text-[10px] text-teal-200/80">Temp °F</Label>
                      <input
                        className="mt-0.5 w-full rounded-lg border border-teal-900/50 bg-zinc-950 px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-500/50"
                        inputMode="decimal"
                        value={temp}
                        onChange={(e) => setTemp(e.target.value)}
                        placeholder="—"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-teal-200/80">BP sys</Label>
                      <input
                        className="mt-0.5 w-full rounded-lg border border-teal-900/50 bg-zinc-950 px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-500/50"
                        inputMode="numeric"
                        value={bpSys}
                        onChange={(e) => setBpSys(e.target.value)}
                        placeholder="—"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-teal-200/80">BP dia</Label>
                      <input
                        className="mt-0.5 w-full rounded-lg border border-teal-900/50 bg-zinc-950 px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-500/50"
                        inputMode="numeric"
                        value={bpDia}
                        onChange={(e) => setBpDia(e.target.value)}
                        placeholder="—"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-teal-200/80">Pulse</Label>
                      <input
                        className="mt-0.5 w-full rounded-lg border border-teal-900/50 bg-zinc-950 px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-500/50"
                        inputMode="numeric"
                        value={pulse}
                        onChange={(e) => setPulse(e.target.value)}
                        placeholder="—"
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    disabled={savingVitals || (!temp.trim() && !bpSys.trim() && !bpDia.trim() && !pulse.trim())}
                    variant="outline"
                    className="h-9 w-full border-teal-700/50 text-teal-200 hover:bg-teal-950/50"
                    onClick={() => void saveVitals()}
                  >
                    {savingVitals ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save vitals & check alerts
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-teal-400" />
              </div>
            )}

            {!success && dailyHistory.length > 0 && (
              <div className="space-y-3 border-t border-teal-900/30 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-teal-200/50">Recent daily notes</p>
                <ul className="space-y-2">
                  {dailyHistory.slice(0, 3).map((row) => (
                    <li key={row.id} className="rounded-lg border border-teal-900/30 bg-black/20 p-3 text-sm">
                      <p className="text-xs text-zinc-500">
                        {row.log_date} · {row.shift}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-zinc-200">{row.general_notes?.trim() || "—"}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
