"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Brain, Stethoscope, FileText, CheckCircle2, Loader2 } from "lucide-react";

import { fetchShiftDailyLogId } from "@/lib/caregiver/daily-log-link";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { requestEvaluateVitals } from "@/lib/infection-control/request-evaluate-vitals";
import { formatResidentDailyNotesDisplay } from "@/lib/residents/resident-log-display-copy";
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
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

// ============================================================================
// SHARED QUICK-ENTRY DIALOG PIECES
// ----------------------------------------------------------------------------
// All three resident quick-entry dialogs (behavior, condition, general note)
// render on the Haven semantic tokens supplied by `DialogContent` (`bg-card`,
// `text-card-foreground`) and the shared form primitives. No dialog carries
// its own decorative palette; status colors are reserved for validation
// errors and the saved confirmation.
// ============================================================================

/** Keeps the taller forms inside the viewport and scrollable on short screens. */
const QUICK_ENTRY_CONTENT_CLASS = "max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-h-[90vh]";

/**
 * Disabled primary actions stay legible: a muted fill with muted-foreground
 * text instead of the primitive's 40% opacity, which drops the white label on
 * the muted-blue fill below readable contrast.
 */
const READABLE_DISABLED_CLASS =
  "disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100";

/**
 * Returns focus to the action that opened the dialog. Radix restores focus on
 * unmount, but with the exit animation the content's focus scope re-runs and
 * focus ends on <body>; capturing the opener ourselves makes the return
 * deterministic for keyboard users.
 */
function useReturnFocusToOpener() {
  const openerRef = useRef<HTMLElement | null>(null);
  const onOpenAutoFocus = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  const onCloseAutoFocus = useCallback((event: Event) => {
    const opener = openerRef.current;
    if (opener && opener.isConnected) {
      event.preventDefault();
      opener.focus();
    }
  }, []);
  return { onOpenAutoFocus, onCloseAutoFocus };
}

function Field({
  id,
  label,
  required,
  helper,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  helper?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <FormLabel htmlFor={id} required={required}>
        {label}
      </FormLabel>
      {children}
      {helper ? <p className="text-sm text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

function CheckboxField({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Label htmlFor={id} className="cursor-pointer text-sm font-medium text-foreground">
      <input
        id={id}
        type="checkbox"
        className="size-4 shrink-0 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      {label}
    </Label>
  );
}

function SaveErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

function ContextLoading() {
  return (
    <div className="flex items-center justify-center py-8" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      <span className="sr-only">Loading facility context</span>
    </div>
  );
}

function SavedState({
  title,
  againLabel,
  onAgain,
  onDone,
}: {
  title: string;
  againLabel: string;
  onAgain: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-6" role="status">
      <div className="flex size-14 items-center justify-center rounded-full border border-success/40 bg-success/10">
        <CheckCircle2 className="size-7 text-success" aria-hidden />
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      <DialogFooter className="w-full gap-2 sm:space-x-0">
        <Button type="button" variant="outline" onClick={onDone} className="sm:flex-1">
          Done
        </Button>
        <Button type="button" onClick={onAgain} className="sm:flex-1">
          {againLabel}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ContextErrorDialog({
  open,
  onOpenChange,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: string;
}) {
  const focusReturn = useReturnFocusToOpener();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" {...focusReturn}>
        <DialogHeader className="pr-8">
          <DialogTitle>Entry unavailable</DialogTitle>
          <DialogDescription>This entry could not be opened for the working facility.</DialogDescription>
        </DialogHeader>
        <SaveErrorNotice message={error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecentEntries({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p className="text-xs font-semibold text-muted-foreground">{heading}</p>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

const RECENT_ENTRY_CLASS = "rounded-[var(--radius)] border border-border bg-muted/30 p-3 text-sm";

function formatEntryStamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

/** Radix Select items cannot carry an empty-string value; this stands in for "not recorded". */
const INTERVENTION_NOT_RECORDED = "not_recorded";

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
  const ids = useId();
  const focusReturn = useReturnFocusToOpener();
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
    return <ContextErrorDialog open={open} onOpenChange={onOpenChange} error={error} />;
  }

  const canSubmit = Boolean(ctx) && !submitting && behavior.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={QUICK_ENTRY_CONTENT_CLASS} data-testid="behavior-log-dialog" {...focusReturn}>
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <Brain className="size-5 text-muted-foreground" aria-hidden />
            Log behavior
          </DialogTitle>
          <DialogDescription>
            Document an observed behavior for <span className="font-medium text-foreground">{residentName}</span>.
            The entry is attributed to you on the current shift.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <SavedState
            title="Behavior entry saved"
            againLabel="Log another"
            onAgain={resetForm}
            onDone={handleResetAndClose}
          />
        ) : (
          <div className="space-y-4">
            {error && <SaveErrorNotice message={error} />}

            {ctx ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${ids}-behavior-type`} label="Behavior type">
                    <Select value={behaviorType} onValueChange={setBehaviorType}>
                      <SelectTrigger id={`${ids}-behavior-type`} className="h-9 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BEHAVIOR_TYPES.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id={`${ids}-duration`} label="Duration (minutes)">
                    <Input
                      id={`${ids}-duration`}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                    />
                  </Field>
                </div>

                <Field id={`${ids}-behavior`} label="What was observed" required>
                  <Textarea
                    id={`${ids}-behavior`}
                    rows={3}
                    required
                    placeholder="Objective description of the behavior"
                    value={behavior}
                    onChange={(e) => setBehavior(e.target.value)}
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${ids}-antecedent`} label="Antecedent (optional)">
                    <Textarea
                      id={`${ids}-antecedent`}
                      rows={2}
                      className="min-h-[56px]"
                      placeholder="What happened before"
                      value={antecedent}
                      onChange={(e) => setAntecedent(e.target.value)}
                    />
                  </Field>
                  <Field id={`${ids}-consequence`} label="Consequence / outcome (optional)">
                    <Textarea
                      id={`${ids}-consequence`}
                      rows={2}
                      className="min-h-[56px]"
                      placeholder="What happened after"
                      value={consequence}
                      onChange={(e) => setConsequence(e.target.value)}
                    />
                  </Field>
                </div>

                <Field
                  id={`${ids}-interventions`}
                  label="Interventions used"
                  helper="Separate several interventions with commas, for example redirection, music, 1:1 sitter."
                >
                  <Input
                    id={`${ids}-interventions`}
                    type="text"
                    value={interventionsText}
                    onChange={(e) => setInterventionsText(e.target.value)}
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${ids}-effective`} label="Intervention effective?">
                    <Select
                      value={interventionEffective === "" ? INTERVENTION_NOT_RECORDED : interventionEffective}
                      onValueChange={(v) =>
                        setInterventionEffective(v === INTERVENTION_NOT_RECORDED ? "" : (v as "yes" | "no"))
                      }
                    >
                      <SelectTrigger id={`${ids}-effective`} className="h-9 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={INTERVENTION_NOT_RECORDED}>Not recorded</SelectItem>
                        <SelectItem value="yes">Yes</SelectItem>
                        <SelectItem value="no">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id={`${ids}-notes`} label="Additional notes">
                    <Input
                      id={`${ids}-notes`}
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </Field>
                </div>

                <CheckboxField
                  id={`${ids}-injury`}
                  label="Injury occurred"
                  checked={injuryOccurred}
                  onCheckedChange={setInjuryOccurred}
                />
                {injuryOccurred && (
                  <Field id={`${ids}-injury-details`} label="Injury details">
                    <Textarea
                      id={`${ids}-injury-details`}
                      rows={2}
                      className="min-h-[56px]"
                      placeholder="Describe the injury"
                      value={injuryDetails}
                      onChange={(e) => setInjuryDetails(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            ) : (
              <ContextLoading />
            )}

            {rows.length > 0 && (
              <RecentEntries heading="Recent behavior entries">
                {rows.map((row) => (
                  <li key={row.id} className={RECENT_ENTRY_CLASS}>
                    <p className="font-medium text-foreground">
                      {BEHAVIOR_TYPES.find((b) => b.value === row.behavior_type)?.label ?? row.behavior_type}
                    </p>
                    <p className="mt-1 text-foreground">{row.behavior}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatEntryStamp(row.occurred_at)} · {row.shift}
                    </p>
                  </li>
                ))}
              </RecentEntries>
            )}

            <DialogFooter className="gap-2 border-t border-border pt-4 sm:space-x-0">
              <Button type="button" variant="outline" onClick={handleResetAndClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!canSubmit}
                className={READABLE_DISABLED_CLASS}
                onClick={() => void submitBehavior()}
              >
                {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Brain aria-hidden />}
                Save behavior entry
              </Button>
            </DialogFooter>
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
  const ids = useId();
  const focusReturn = useReturnFocusToOpener();
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
    return <ContextErrorDialog open={open} onOpenChange={onOpenChange} error={error} />;
  }

  const canSubmit = Boolean(ctx) && !submitting && description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={QUICK_ENTRY_CONTENT_CLASS} data-testid="condition-log-dialog" {...focusReturn}>
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="size-5 text-muted-foreground" aria-hidden />
            Log condition
          </DialogTitle>
          <DialogDescription>
            Report new or worsening symptoms for <span className="font-medium text-foreground">{residentName}</span>.
            For emergencies, use your facility escalation protocol.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <SavedState
            title="Condition report submitted"
            againLabel="Log another"
            onAgain={resetForm}
            onDone={handleResetAndClose}
          />
        ) : (
          <div className="space-y-4">
            {error && <SaveErrorNotice message={error} />}

            {ctx ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${ids}-category`} label="Category">
                    <Select value={changeType} onValueChange={setChangeType}>
                      <SelectTrigger id={`${ids}-category`} className="h-9 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHANGE_TYPES.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id={`${ids}-severity`} label="Severity">
                    <Select value={severity} onValueChange={setSeverity}>
                      <SelectTrigger id={`${ids}-severity`} className="h-9 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEVERITIES.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field id={`${ids}-description`} label="Description" required>
                  <Textarea
                    id={`${ids}-description`}
                    rows={4}
                    required
                    placeholder="Objective findings, vitals if taken, what changed and when"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>

                <CheckboxField
                  id={`${ids}-nurse-notified`}
                  label="Nurse has been notified (time and reporter are recorded)"
                  checked={nurseNotified}
                  onCheckedChange={setNurseNotified}
                />
              </div>
            ) : (
              <ContextLoading />
            )}

            {rows.length > 0 && (
              <RecentEntries heading="Recent condition reports">
                {rows.map((row) => (
                  <li key={row.id} className={RECENT_ENTRY_CLASS}>
                    <p className="font-medium text-foreground">
                      {CHANGE_TYPES.find((c) => c.value === row.change_type)?.label ?? row.change_type}
                      <span className="font-normal text-muted-foreground"> · </span>
                      <span className="font-normal capitalize text-muted-foreground">{row.severity}</span>
                    </p>
                    <p className="mt-1 text-foreground">{row.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatEntryStamp(row.reported_at)} · {row.shift}
                      {row.nurse_notified && <span> · nurse notified</span>}
                    </p>
                  </li>
                ))}
              </RecentEntries>
            )}

            <DialogFooter className="gap-2 border-t border-border pt-4 sm:space-x-0">
              <Button type="button" variant="outline" onClick={handleResetAndClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!canSubmit}
                className={READABLE_DISABLED_CLASS}
                onClick={() => void submitReport()}
              >
                {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Stethoscope aria-hidden />}
                Submit condition report
              </Button>
            </DialogFooter>
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
  const ids = useId();
  const focusReturn = useReturnFocusToOpener();
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
    return <ContextErrorDialog open={open} onOpenChange={onOpenChange} error={error} />;
  }

  const canSaveNote = Boolean(ctx) && !savingNote && noteDraft.trim().length > 0;
  const hasVitals = Boolean(temp.trim() || bpSys.trim() || bpDia.trim() || pulse.trim());
  const canSaveVitals = Boolean(ctx) && !savingVitals && hasVitals;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={QUICK_ENTRY_CONTENT_CLASS} data-testid="general-note-dialog" {...focusReturn}>
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-muted-foreground" aria-hidden />
            General note
          </DialogTitle>
          <DialogDescription>
            Add a note to today&apos;s daily log for <span className="font-medium text-foreground">{residentName}</span>
            {ctx ? (
              <>
                {" "}
                · {zonedYmd(new Date(), ctx.timeZone)} · {currentShiftForTimezone(ctx.timeZone)} shift
              </>
            ) : null}
            . Vitals are optional and save separately below.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <SavedState
            title="Saved to the daily log"
            againLabel="Add another"
            onAgain={resetForm}
            onDone={handleResetAndClose}
          />
        ) : (
          <div className="space-y-4">
            {error && <SaveErrorNotice message={error} />}

            {ctx ? (
              <div className="space-y-5">
                <section aria-label="Shift note" className="space-y-3">
                  <Field id={`${ids}-note`} label="Shift note">
                    <Textarea
                      id={`${ids}-note`}
                      rows={3}
                      placeholder="Objective, brief narrative for this pass"
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                    />
                  </Field>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      disabled={!canSaveNote}
                      className={READABLE_DISABLED_CLASS}
                      onClick={() => void appendShiftNote()}
                    >
                      {savingNote ? <Loader2 className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
                      Save note to daily log
                    </Button>
                  </div>
                </section>

                <section aria-labelledby={`${ids}-vitals-heading`} className="space-y-3 border-t border-border pt-4">
                  <div className="space-y-1">
                    <h3 id={`${ids}-vitals-heading`} className="text-sm font-semibold text-foreground">
                      Vitals (optional)
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Saved to the same shift log as a separate step. Saving vitals also runs the alert check.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Field id={`${ids}-temp`} label="Temp °F">
                      <Input
                        id={`${ids}-temp`}
                        inputMode="decimal"
                        value={temp}
                        onChange={(e) => setTemp(e.target.value)}
                      />
                    </Field>
                    <Field id={`${ids}-bp-sys`} label="BP systolic">
                      <Input
                        id={`${ids}-bp-sys`}
                        inputMode="numeric"
                        value={bpSys}
                        onChange={(e) => setBpSys(e.target.value)}
                      />
                    </Field>
                    <Field id={`${ids}-bp-dia`} label="BP diastolic">
                      <Input
                        id={`${ids}-bp-dia`}
                        inputMode="numeric"
                        value={bpDia}
                        onChange={(e) => setBpDia(e.target.value)}
                      />
                    </Field>
                    <Field id={`${ids}-pulse`} label="Pulse">
                      <Input
                        id={`${ids}-pulse`}
                        inputMode="numeric"
                        value={pulse}
                        onChange={(e) => setPulse(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canSaveVitals}
                      className={READABLE_DISABLED_CLASS}
                      onClick={() => void saveVitals()}
                    >
                      {savingVitals ? <Loader2 className="animate-spin" aria-hidden /> : null}
                      Save vitals & check alerts
                    </Button>
                  </div>
                </section>
              </div>
            ) : (
              <ContextLoading />
            )}

            {dailyHistory.length > 0 && (
              <RecentEntries heading="Recent daily notes">
                {dailyHistory.slice(0, 3).map((row) => (
                  <li key={row.id} className={RECENT_ENTRY_CLASS}>
                    <p className="text-xs text-muted-foreground">
                      {row.log_date} · {row.shift}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">
                      {formatResidentDailyNotesDisplay(row.general_notes)}
                    </p>
                  </li>
                ))}
              </RecentEntries>
            )}

            <DialogFooter className="border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={handleResetAndClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
