"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";

import { assessmentFormSchema, type AssessmentFormData } from "@/lib/validation/assessment";
import type { AssessmentTemplate, AssessmentTemplateItem } from "@/lib/assessments/types";
import {
  ASSESSMENT_COMPLETE_TO_CALCULATE_COPY,
  ASSESSMENT_NOT_RECORDED_COPY,
  ASSESSMENT_PROVISIONAL_LABEL,
  ASSESSMENT_RECORDED_LABEL,
  ASSESSMENT_SCHEDULE_BASIS_COPY,
  ASSESSMENT_UNSAVED_COPY,
  computeCompletedResult,
  computeEntryProgress,
  computeProvisionalResult,
  formatDuplicateWarning,
  formatPoints,
  formatRiskLevel,
  formatScheduleInterval,
  formatScoreOfMax,
  formatScoreRange,
  formatSectionsCompleted,
  formatHeldInstrumentSaveError,
  formatSectionsRemaining,
  formatSwitchInstrumentWarning,
  heldInstrumentReason,
  isHeldInstrumentSaveError,
  isInstrumentHeld,
  sectionAnchorId,
} from "@/lib/assessments/assessment-entry-model";
import {
  applyAssessmentDownstreamUpdates,
  countSameDayAssessments,
  insertAssessmentRecord,
  type RecordedAssessment,
} from "@/lib/assessments/record-assessment";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient } from "@/lib/supabase/client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { RecordDetailSection } from "@/design-system/components/record-detail";

/**
 * Risk-level tone. The chip keeps its label in `text-foreground` (AA contrast
 * on the tinted background) and carries the tone in the dot, border and tint,
 * so the interpretation reads the same for colour-blind staff and in axe.
 */
const RISK_TONES: Record<string, "success" | "warning" | "danger"> = {
  low: "success",
  standard: "warning",
  high: "danger",
  level_1: "success",
  level_2: "warning",
  level_3: "danger",
  none: "success",
  mild: "success",
  moderate: "warning",
  very_high: "danger",
  minimal: "success",
  moderately_severe: "warning",
  severe: "danger",
};

const RISK_TONE_CLASSES = {
  success: { chip: "border-success/30 bg-success/10", dot: "bg-success" },
  warning: { chip: "border-warning/30 bg-warning/10", dot: "bg-warning" },
  danger: { chip: "border-destructive/30 bg-destructive/10", dot: "bg-destructive" },
  muted: { chip: "border-border bg-muted", dot: "bg-muted-foreground/60" },
} as const;

type Step = "answer" | "review";

function RiskBadge({ riskLevel }: { riskLevel: string }) {
  const tone = RISK_TONE_CLASSES[RISK_TONES[riskLevel] ?? "muted"];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium normal-case text-foreground",
        tone.chip,
      )}
    >
      <span className={cn("inline-block size-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
      {formatRiskLevel(riskLevel)}
    </span>
  );
}

export default function AssessmentEntryPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { user, organizationId, appRole, fullName, email } = useHavenAuth();
  const historyHref = `/admin/residents/${residentId}/assessments`;

  const [templates, setTemplates] = useState<AssessmentTemplate[]>([]);
  const [residentName, setResidentName] = useState("");
  const [facilityId, setFacilityId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedType, setSelectedType] = useState<string>("");
  const [step, setStep] = useState<Step>("answer");
  const [switchPrompt, setSwitchPrompt] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<RecordedAssessment | null>(null);
  const [downstreamPending, setDownstreamPending] = useState(false);

  const form = useForm<AssessmentFormData>({
    resolver: zodResolver(assessmentFormSchema),
    defaultValues: {
      assessmentType: "",
      // The assessment date is the date the instrument is administered. The
      // Eastern calendar day is the expected value for a nurse completing it
      // now; it stays editable for back-dated entries.
      assessmentDate: todayFacilityDateIso(),
      scores: {},
      notes: "",
    },
  });

  const watchScores = form.watch("scores");
  const watchDate = form.watch("assessmentDate");
  const watchNotes = form.watch("notes");

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.assessment_type === selectedType) ?? null,
    [templates, selectedType],
  );

  // react-hook-form mutates the nested `scores` object in place, so its
  // reference is stable across answers. Derive progress on every render
  // (watch() already re-renders on change) rather than memoising on it.
  const progress = selectedTemplate ? computeEntryProgress(selectedTemplate, watchScores) : null;
  const provisional = selectedTemplate
    ? computeProvisionalResult(selectedTemplate, watchScores)
    : null;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (!organizationId) throw new Error("No organization on profile");

      const { data: resident } = await supabase
        .from("residents")
        .select("first_name, last_name, facility_id")
        .eq("id", residentId)
        .maybeSingle();
      if (!resident) throw new Error("Resident not found");
      setResidentName(`${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim());
      setFacilityId(resident.facility_id);

      const { data: tpls, error: tplErr } = await supabase
        .from("assessment_templates")
        .select("*")
        .order("assessment_type");
      if (tplErr) throw new Error(tplErr.message);

      const role = appRole ?? "";
      const privilegedRoles = new Set(["owner", "org_admin"]);
      const allowed = (tpls ?? []).filter((t) => {
        if (privilegedRoles.has(role)) return true;
        const rr = t.required_role as string[] | null;
        return Array.isArray(rr) && rr.includes(role);
      }) as unknown as AssessmentTemplate[];
      setTemplates(allowed);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId, organizationId, appRole]);

  useEffect(() => {
    void load();
  }, [load]);

  function selectInstrument(type: string) {
    // A held instrument renders no control, so this is defence in depth: a
    // stale list or a replayed click must not open a form the save path will
    // refuse anyway.
    const target = templates.find((t) => t.assessment_type === type);
    if (target && isInstrumentHeld(target)) return;
    setSelectedType(type);
    form.setValue("assessmentType", type);
    form.setValue("scores", {});
    setSwitchPrompt(false);
    setStep("answer");
    setDuplicateCount(null);
    setSaveError(null);
  }

  function clearInstrument() {
    setSelectedType("");
    form.setValue("assessmentType", "");
    form.setValue("scores", {});
    setSwitchPrompt(false);
    setStep("answer");
    setDuplicateCount(null);
    setSaveError(null);
  }

  function requestChangeInstrument() {
    if (!progress || progress.answeredSections === 0) {
      clearInstrument();
      return;
    }
    setSwitchPrompt(true);
  }

  function focusSection(itemKey: string | null) {
    if (!itemKey || typeof document === "undefined") return;
    const el = document.getElementById(sectionAnchorId(itemKey));
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    const radio = el.querySelector<HTMLInputElement>('input[type="radio"]');
    radio?.focus({ preventScroll: true });
  }

  async function goToReview(data: AssessmentFormData) {
    if (!selectedTemplate) return;
    const completed = computeCompletedResult(selectedTemplate, data.scores);
    if (!completed) {
      setSaveError("Answer every section before reviewing the result.");
      focusSection(progress?.firstUnansweredKey ?? null);
      return;
    }
    setSaveError(null);
    setStep("review");
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
    try {
      const count = await countSameDayAssessments(supabase, {
        residentId,
        assessmentType: selectedTemplate.assessment_type,
        assessmentDate: data.assessmentDate,
      });
      setDuplicateCount(count);
    } catch {
      setDuplicateCount(null);
    }
  }

  async function recordAssessment() {
    if (!selectedTemplate || !facilityId || !organizationId || saving) return;
    const values = form.getValues();
    const completed = computeCompletedResult(selectedTemplate, values.scores);
    if (!completed) {
      setSaveError("Answer every section before recording the result.");
      setStep("answer");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (!user) throw new Error("Not authenticated");

      let record = recorded;
      if (!record) {
        record = await insertAssessmentRecord(supabase, {
          residentId,
          facilityId,
          organizationId,
          userId: user.id,
          template: selectedTemplate,
          assessmentDate: values.assessmentDate,
          totalScore: completed.totalScore,
          riskLevel: completed.riskLevel,
          scores: completed.scores,
          notes: values.notes?.trim() ? values.notes : null,
        });
        setRecorded(record);
      }

      setDownstreamPending(true);
      await applyAssessmentDownstreamUpdates(supabase, {
        residentId,
        facilityId,
        organizationId,
        assessmentType: record.assessmentType,
        instrumentName: record.instrumentName,
        totalScore: record.totalScore,
        riskLevel: record.riskLevel,
      });
      setDownstreamPending(false);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed to record assessment";
      setSaveError(
        isHeldInstrumentSaveError(raw)
          ? formatHeldInstrumentSaveError(selectedTemplate.name)
          : raw,
      );
    } finally {
      setSaving(false);
    }
  }

  function startAnother() {
    setRecorded(null);
    setDownstreamPending(false);
    setSaveError(null);
    setDuplicateCount(null);
    setSwitchPrompt(false);
    setStep("answer");
    setSelectedType("");
    form.reset({
      assessmentType: "",
      assessmentDate: todayFacilityDateIso(),
      scores: {},
      notes: "",
    });
  }

  const assessedByLabel = fullName || email || "Signed-in staff";

  const backLink = (
    <a href={historyHref} className="text-sm text-muted-foreground hover:text-foreground">
      ← Back to assessments
    </a>
  );

  // --- Recorded ------------------------------------------------------------

  if (recorded && !downstreamPending && !saveError) {
    return (
      <div className="space-y-4">
        {backLink}
        <RecordDetailSection title="Assessment recorded" className="border-success/20">
          <div className="flex flex-col items-start gap-3 py-2" role="status">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" aria-hidden />
              <p className="text-base font-semibold text-foreground">{recorded.instrumentName}</p>
            </div>
            <p className="text-sm text-foreground">
              {residentName ? `${residentName} · ` : ""}
              Assessment date <span className="tabular-nums">{recorded.assessmentDate}</span>
              {" · "}
              {ASSESSMENT_RECORDED_LABEL} score{" "}
              <span className="tabular-nums font-semibold">
                {formatScoreOfMax(recorded.totalScore, selectedTemplate?.score_range_max)}
              </span>
              {" · "}
              <RiskBadge riskLevel={recorded.riskLevel} />
            </p>
            <p className="text-sm text-muted-foreground">
              Recorded to {residentName ? `${residentName}'s` : "the resident's"} assessment history by{" "}
              {assessedByLabel}. Next due <span className="tabular-nums">{recorded.nextDueDate}</span>{" "}
              ({ASSESSMENT_SCHEDULE_BASIS_COPY}).
            </p>
            <div className="flex gap-3 pt-1">
              <a href={historyHref}>
                <Button variant="outline" size="sm">View history</Button>
              </a>
              <Button size="sm" onClick={startAnother}>
                Start another assessment
              </Button>
            </div>
          </div>
        </RecordDetailSection>
      </div>
    );
  }

  // --- Picker --------------------------------------------------------------

  if (!selectedTemplate) {
    return (
      <div className="space-y-4">
        {backLink}
        <RecordDetailSection
          title="New assessment"
          description={
            residentName
              ? `Choose the assessment to complete for ${residentName}.`
              : "Choose the assessment to complete."
          }
        >
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden /> Loading assessment types…
            </div>
          )}

          {loadError && !loading && (
            <div
              role="alert"
              className="rounded-[8px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
            >
              {loadError}
              <Button variant="outline" size="sm" onClick={load} className="ml-2">
                Retry
              </Button>
            </div>
          )}

          {!loading && !loadError && templates.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No assessment types available for your role.
            </div>
          )}

          {!loading && !loadError && templates.length > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {templates.map((t) => {
                  const heldReason = heldInstrumentReason(t);

                  // A held instrument stays listed so staff can see it exists
                  // and why it is unavailable, but it is plain text: no
                  // button, no radio, no link, nothing selectable. The
                  // database refuses the insert regardless (COL-430).
                  if (heldReason) {
                    return (
                      <div
                        key={t.assessment_type}
                        aria-disabled="true"
                        className="rounded-[8px] border border-dashed border-border bg-muted/40 px-4 py-4 text-left"
                      >
                        <div className="font-medium text-muted-foreground">{t.name}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{heldReason}</div>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={t.assessment_type}
                      type="button"
                      onClick={() => selectInstrument(t.assessment_type)}
                      className="rounded-[8px] border border-border bg-card px-4 py-4 text-left transition-colors duration-[var(--motion-duration-micro)] hover:border-primary/30 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="font-medium text-foreground">{t.name}</div>
                      {t.description && (
                        <div className="mt-1 text-sm text-muted-foreground">{t.description}</div>
                      )}
                      <div className="mt-2 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {formatScoreRange(t.score_range_min, t.score_range_max)}
                        </span>
                        {" · "}
                        <span className="tabular-nums">
                          {formatScheduleInterval(t.default_frequency_days)}
                        </span>{" "}
                        <span>({ASSESSMENT_SCHEDULE_BASIS_COPY})</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Intervals are Haven defaults used to set the next due date. They are not
                facility-configured schedules.
              </p>
            </>
          )}
        </RecordDetailSection>
      </div>
    );
  }

  const template = selectedTemplate;
  const entry = progress ?? computeEntryProgress(template, watchScores);
  const result = provisional ?? computeProvisionalResult(template, watchScores);
  const metaLine = [
    residentName || null,
    formatScoreRange(template.score_range_min, template.score_range_max),
    `${formatScheduleInterval(template.default_frequency_days)} (${ASSESSMENT_SCHEDULE_BASIS_COPY})`,
  ]
    .filter(Boolean)
    .join(" · ");

  // --- Review --------------------------------------------------------------

  if (step === "review") {
    const completed = computeCompletedResult(template, watchScores);
    const notesText = watchNotes?.trim() ?? "";
    return (
      <div className="space-y-4">
        {backLink}
        <RecordDetailSection
          title={`Review ${template.name}`}
          description="Check each answer before recording. Nothing is saved until you record the assessment."
          action={
            recorded ? null : (
              <Button variant="ghost" size="sm" type="button" onClick={() => setStep("answer")}>
                Back to answers
              </Button>
            )
          }
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Resident</dt>
              <dd className="text-foreground">{residentName || "Resident"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Assessment date (ET)</dt>
              <dd className="tabular-nums text-foreground">{watchDate}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Assessed by</dt>
              <dd className="text-foreground">{assessedByLabel}</dd>
            </div>
          </dl>

          <table className="w-full max-w-3xl text-sm">
            <caption className="sr-only">Answers for {template.name}</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Section
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Answer
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Points
                </th>
              </tr>
            </thead>
            <tbody>
              {entry.sections.map((s) => (
                <tr key={s.key} className="border-b border-border/60">
                  <td className="py-2 pr-3 text-foreground">
                    {s.position}. {s.label}
                  </td>
                  <td className="py-2 pr-3 text-foreground">{s.selectedLabel ?? "Unanswered"}</td>
                  <td className="py-2 text-right tabular-nums text-foreground">
                    {s.selectedValue ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {completed && (
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2} className="py-2 pr-3 text-left font-semibold text-foreground">
                    Total
                  </th>
                  <td className="py-2 text-right tabular-nums font-semibold text-foreground">
                    {formatScoreOfMax(completed.totalScore, template.score_range_max)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>

          {completed && (
            <div
              role="status"
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-[8px] border px-4 py-3 text-sm",
                recorded ? "border-success/30 bg-success/10" : "border-border bg-muted",
              )}
            >
              <span className="font-medium text-foreground">
                {recorded ? ASSESSMENT_RECORDED_LABEL : ASSESSMENT_PROVISIONAL_LABEL}
              </span>
              <span className="tabular-nums text-lg font-semibold text-foreground">
                {formatScoreOfMax(completed.totalScore, template.score_range_max)}
              </span>
              <RiskBadge riskLevel={completed.riskLevel} />
              {!recorded && (
                <span className="text-muted-foreground">· {ASSESSMENT_NOT_RECORDED_COPY}</span>
              )}
            </div>
          )}

          {notesText && (
            <div className="max-w-3xl text-sm">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="whitespace-pre-wrap text-foreground">{notesText}</p>
            </div>
          )}

          {!recorded && duplicateCount != null && duplicateCount > 0 && (
            <div
              role="status"
              className="rounded-[8px] border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
            >
              {formatDuplicateWarning(template.name, watchDate, residentName)}{" "}
              <a href={historyHref} className="underline underline-offset-2">
                View history
              </a>
            </div>
          )}

          {saveError && (
            <div
              role="alert"
              className="rounded-[8px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
            >
              {recorded
                ? "Assessment recorded. Follow-up updates to the resident summary did not finish. "
                : "The assessment was not recorded. Your answers are kept. "}
              {saveError}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3">
            {recorded ? (
              <>
                <a href={historyHref}>
                  <Button variant="outline" type="button">
                    View history
                  </Button>
                </a>
                <Button type="button" onClick={() => void recordAssessment()} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Retrying…
                    </>
                  ) : (
                    "Retry follow-up updates"
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" type="button" onClick={() => setStep("answer")}>
                  Back to answers
                </Button>
                <Button
                  type="button"
                  onClick={() => void recordAssessment()}
                  disabled={saving || !completed}
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Recording…
                    </>
                  ) : saveError ? (
                    "Retry recording"
                  ) : duplicateCount != null && duplicateCount > 0 ? (
                    "Record anyway"
                  ) : (
                    "Record assessment"
                  )}
                </Button>
              </>
            )}
          </div>
        </RecordDetailSection>
      </div>
    );
  }

  // --- Answer --------------------------------------------------------------

  return (
    <div className="space-y-4">
      {backLink}
      <RecordDetailSection
        title={template.name}
        description={template.description ?? undefined}
        action={
          <Button variant="ghost" size="sm" type="button" onClick={requestChangeInstrument}>
            Change assessment
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">{metaLine}</p>

        {switchPrompt && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-[8px] border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
          >
            <span className="min-w-0 flex-1">
              {formatSwitchInstrumentWarning(template.name, entry.answeredSections)}
            </span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setSwitchPrompt(false)}>
                Keep answers
              </Button>
              <Button variant="destructive" size="sm" type="button" onClick={clearInstrument}>
                Discard and change
              </Button>
            </span>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(goToReview)} className="space-y-6">
            <FormField
              control={form.control}
              name="assessmentDate"
              render={({ field }) => (
                <FormItem>
                  {/* Bound to the control by FormItem context (ui/form). */}
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <FormLabel>Assessment date (ET)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} className="max-w-xs" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div
              role="status"
              aria-live="polite"
              id="assessment-progress"
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] border px-4 py-3 text-sm",
                result.state === "complete" ? "border-border bg-muted" : "border-border bg-card",
              )}
            >
              {result.state === "complete" ? (
                <>
                  <span className="font-medium text-foreground">{ASSESSMENT_PROVISIONAL_LABEL}</span>
                  <span className="tabular-nums text-lg font-semibold text-foreground">
                    {formatScoreOfMax(result.totalScore, result.scoreMax)}
                  </span>
                  <RiskBadge riskLevel={result.riskLevel} />
                  <span className="text-muted-foreground">· {ASSESSMENT_NOT_RECORDED_COPY}</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {formatSectionsCompleted(entry.answeredSections, entry.totalSections)}
                  </span>
                  <span className="text-muted-foreground">{ASSESSMENT_COMPLETE_TO_CALCULATE_COPY}</span>
                </>
              )}
            </div>

            <nav aria-label="Assessment sections" className="flex flex-wrap gap-2">
              {entry.sections.map((s) => (
                <a
                  key={s.key}
                  href={`#${sectionAnchorId(s.key)}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors duration-[var(--motion-duration-micro)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    s.answered
                      ? "border-success/30 bg-success/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {s.answered ? (
                    <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                  ) : (
                    <Circle className="size-3.5" aria-hidden />
                  )}
                  <span>
                    {s.position}. {s.label}
                  </span>
                  <span className="sr-only">{s.answered ? ", answered" : ", unanswered"}</span>
                </a>
              ))}
            </nav>

            <div className="max-w-3xl space-y-6">
              {template.items.map((item: AssessmentTemplateItem, index) => (
                <FormField
                  key={item.key}
                  control={form.control}
                  name={`scores.${item.key}`}
                  render={({ field }) => (
                    <FormItem
                      id={sectionAnchorId(item.key)}
                      className="scroll-mt-24 border-t border-border pt-4"
                    >
                      <fieldset>
                        <legend className="text-sm font-semibold text-foreground">
                          {index + 1}. {item.label}
                        </legend>
                        {item.instructions && (
                          <p className="mt-1 text-xs text-muted-foreground">{item.instructions}</p>
                        )}
                        <div className="mt-2 flex justify-end pr-3 text-xs text-muted-foreground" aria-hidden>
                          Points
                        </div>
                        <div className="mt-1 space-y-2">
                          {item.options.map((opt) => {
                            const checked = field.value === opt.value;
                            return (
                              <label
                                key={opt.value}
                                className={cn(
                                  "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm transition-colors duration-[var(--motion-duration-micro)]",
                                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1",
                                  checked
                                    ? "border-primary/50 bg-primary/5 text-foreground"
                                    : "border-border text-foreground hover:bg-muted",
                                )}
                              >
                                <input
                                  type="radio"
                                  name={item.key}
                                  value={opt.value}
                                  checked={checked}
                                  onChange={() => field.onChange(opt.value)}
                                  className="mt-0.5 size-4 shrink-0 accent-primary"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block">{opt.label}</span>
                                  {opt.definition && (
                                    <span className="block text-xs text-muted-foreground">
                                      {opt.definition}
                                    </span>
                                  )}
                                </span>
                                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                                  <span aria-hidden>{opt.value}</span>
                                  <span className="sr-only">{formatPoints(opt.value)}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="max-w-3xl">
                  {/* Bound to the control by FormItem context (ui/form). */}
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Clinical observations, context for answers…"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {saveError && (
              <div
                role="alert"
                className="rounded-[8px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
              >
                {saveError}
              </div>
            )}

            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 py-3 backdrop-blur">
              <p id="assessment-unsaved-status" className="text-sm text-muted-foreground">
                {ASSESSMENT_UNSAVED_COPY} · {formatSectionsRemaining(entry.remainingSections)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => router.push(historyHref)}>
                  Cancel
                </Button>
                {!entry.complete && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => focusSection(entry.firstUnansweredKey)}
                  >
                    Next unanswered
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={!entry.complete}
                  aria-describedby="assessment-unsaved-status"
                >
                  Review assessment
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </RecordDetailSection>
    </div>
  );
}
