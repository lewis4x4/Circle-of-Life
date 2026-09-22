"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { registerRouteLeaveGuard } from "@/components/layout/navigation-pending";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { formatCarePlanDateOnly } from "@/lib/care-plans/care-plan-display-copy";
import {
  CARE_PLAN_ASSISTANCE_LABELS,
  CARE_PLAN_CATEGORY_LABELS,
  CARE_PLAN_EFFECTIVE_DATE_HELP,
  CARE_PLAN_FIELD_HELP,
  CARE_PLAN_FIELD_LABELS,
  CARE_PLAN_REVIEW_DUE_HELP,
  CARE_PLAN_SAVE_MEANING_COPY,
  carePlanEditorCopy,
  easternTodayIso,
  formatCarePlanChangeSummary,
  isUntouchedCarePlanNeed,
  summarizeCarePlanDraftChanges,
  summarizeCarePlanNeed,
  validateCarePlanDraft,
  type CarePlanDraftIssue,
  type CarePlanDraftNeed,
  type CarePlanEditorMode,
  type CarePlanNeedField,
  type CarePlanVersionSummary,
} from "@/lib/care-plans/care-plan-editor-state";
import {
  DEFAULT_REVIEW_MONTHS,
  draftCarePlanFromForm1823,
  type CarePlanDraftGap,
  type Form1823DraftSource,
} from "@/lib/care-plans/draft-from-form-1823";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Who may draft a version — the same roles `create_care_plan_revision_review` accepts. */
export const CARE_PLAN_AUTHOR_ROLES = ["owner", "org_admin", "facility_admin", "med_tech"] as const;

type DraftLine = CarePlanDraftNeed & { key: string };

type LoadedItem = Partial<{ [K in keyof CarePlanDraftNeed]: CarePlanDraftNeed[K] | null }> & { id?: string | null };

const LEAVE_PROMPT = "This care plan has unsaved changes. Leave without saving?";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function blankLine(): DraftLine {
  return {
    key: newKey(),
    category: "",
    title: "",
    description: "",
    assistance_level: "",
    frequency: "",
    goal: "",
    interventions: [],
    special_instructions: "",
  };
}

function lineFromLoaded(item: LoadedItem): DraftLine {
  return {
    key: newKey(),
    sourceId: item.id ?? undefined,
    category: item.category ?? "",
    title: item.title ?? "",
    description: item.description ?? "",
    assistance_level: item.assistance_level ?? "",
    frequency: item.frequency ?? "",
    goal: item.goal ?? "",
    interventions: item.interventions ?? [],
    special_instructions: item.special_instructions ?? "",
  };
}

function toRpcItem(line: DraftLine) {
  return {
    category: line.category,
    title: line.title.trim(),
    description: line.description.trim(),
    assistance_level: line.assistance_level,
    frequency: line.frequency.trim(),
    goal: line.goal.trim(),
    interventions: line.interventions.map((entry) => entry.trim()).filter(Boolean),
    special_instructions: line.special_instructions.trim(),
  };
}

/** Supabase returns plain `{ message }` objects as often as Error instances. */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return "Care plan was not saved";
}

const NATIVE_SELECT_CLASS =
  "h-9 w-full min-w-0 rounded-[var(--radius)] border border-input bg-background px-3 py-1 text-base outline-none transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm";

export function CarePlanAuthor({
  residentId,
  residentName,
  facilityName,
  mode,
  previous,
  initialItems,
  sourceForm1823,
  medicationSystemLabel,
  onSaved,
}: {
  residentId: string;
  residentName: string;
  /** The resident's facility, named so the save destination is never ambiguous. */
  facilityName: string | null;
  /** `first` or `revision`; a `pending` state renders no editor. */
  mode: Exclude<CarePlanEditorMode, "pending">;
  /** The version being revised; null for a first plan. */
  previous: CarePlanVersionSummary | null;
  /** Lines of the version being revised (empty for a first plan). */
  initialItems: LoadedItem[];
  /** The resident's current Form 1823, when there is one to draft from. */
  sourceForm1823?: Form1823DraftSource | null;
  /** The facility's medication orders-of-record label, for the drafted medication line. */
  medicationSystemLabel?: string | null;
  onSaved: () => void;
}) {
  const { appRole } = useHavenAuth();
  const client = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [removed, setRemoved] = useState<Array<{ line: DraftLine; index: number }>>([]);
  const [effective, setEffective] = useState("");
  const [review, setReview] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [gaps, setGaps] = useState<CarePlanDraftGap[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadedLines = useMemo(() => initialItems.map(lineFromLoaded), [initialItems]);
  const copy = carePlanEditorCopy(mode, previous);
  const draft = useMemo(() => ({ effective, review, notes, needs: lines }), [effective, review, notes, lines]);
  const issues = useMemo(() => validateCarePlanDraft(draft), [draft]);
  const changes = useMemo(
    () => summarizeCarePlanDraftChanges(loadedLines, draft, { effective: "", review: "", notes: "" }),
    [loadedLines, draft],
  );
  const dirty = open && (changes.dirty || sourceId != null);
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Leaving with unsaved entries: in-app links and browser traversal go through
  // the shell's guard; reloads and closes go through beforeunload.
  useEffect(() => {
    const unbind = registerRouteLeaveGuard((silent) => !dirtyRef.current || (!silent && window.confirm(LEAVE_PROMPT)));
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      unbind();
      window.removeEventListener("beforeunload", warn);
    };
  }, []);

  const start = useCallback(
    (next: { lines: DraftLine[]; effective: string; review: string; notes: string; gaps: CarePlanDraftGap[]; sourceId: string | null }) => {
      setLines(next.lines);
      setExpanded(new Set(next.lines.map((line) => line.key)));
      setRemoved([]);
      setEffective(next.effective);
      setReview(next.review);
      setNotes(next.notes);
      setGaps(next.gaps);
      setSourceId(next.sourceId);
      setError(null);
      setAttempted(false);
      setRequestId(newKey());
      setOpen(true);
      requestAnimationFrame(() => headingRef.current?.focus());
    },
    [],
  );

  function begin() {
    const next = loadedLines.length ? loadedLines.map((line) => ({ ...line, key: newKey() })) : [blankLine()];
    start({ lines: next, effective: "", review: "", notes: "", gaps: [], sourceId: null });
  }

  function beginFromForm1823() {
    if (!sourceForm1823) return;
    const drafted = draftCarePlanFromForm1823(sourceForm1823, {
      today: easternTodayIso(),
      medicationSystemLabel: medicationSystemLabel ?? null,
    });
    start({
      lines: drafted.items.map((item) => ({ ...item, key: newKey() })),
      effective: drafted.effectiveDate,
      review: drafted.reviewDueDate,
      notes: drafted.notes,
      gaps: drafted.gaps,
      sourceId: sourceForm1823.id,
    });
  }

  function cancel() {
    if (dirty && !window.confirm("Discard this unsaved care plan?")) return;
    setOpen(false);
    setError(null);
  }

  function patch(key: string, field: CarePlanNeedField, value: string | string[]) {
    setLines((prior) => prior.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  }

  function toggle(key: string) {
    setExpanded((prior) => {
      const next = new Set(prior);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addLine() {
    const line = blankLine();
    setLines((prior) => [...prior, line]);
    setExpanded((prior) => new Set(prior).add(line.key));
    requestAnimationFrame(() => document.getElementById(`need-${line.key}-category`)?.focus());
  }

  function removeLine(index: number) {
    const line = lines[index];
    if (!line) return;
    setLines((prior) => prior.filter((_, i) => i !== index));
    // A blank line nobody typed into needs no way back.
    if (!isUntouchedCarePlanNeed(line)) setRemoved((prior) => [...prior, { line, index }]);
  }

  function undoRemove(key: string) {
    const entry = removed.find((item) => item.line.key === key);
    if (!entry) return;
    setRemoved((prior) => prior.filter((item) => item.line.key !== key));
    setLines((prior) => {
      const next = [...prior];
      next.splice(Math.min(entry.index, next.length), 0, entry.line);
      return next;
    });
    setExpanded((prior) => new Set(prior).add(key));
  }

  function focusFirstIssue(first: CarePlanDraftIssue) {
    const id =
      first.scope === "plan"
        ? first.field === "needs"
          ? "care-plan-add-need"
          : `care-plan-${first.field}`
        : `need-${lines[first.scope]?.key}-${first.field}`;
    if (first.scope !== "plan") {
      const key = lines[first.scope]?.key;
      if (key) setExpanded((prior) => new Set(prior).add(key));
    }
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function save() {
    if (busy) return;
    setAttempted(true);
    if (issues.length > 0) {
      focusFirstIssue(issues[0]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await client.rpc("create_care_plan_revision_review" as never, {
        p_id: requestId,
        p_resident_id: residentId,
        p_previous_id: previous?.id ?? null,
        p_effective: effective,
        p_review: review,
        p_notes: notes,
        p_items: lines.map(toRpcItem),
        p_source_form_1823_id: sourceId,
      } as never);
      if (result.error) throw result.error;
      if (typeof result.data !== "string") throw new Error("Care-plan version was not acknowledged");
      dirtyRef.current = false;
      setOpen(false);
      onSaved();
    } catch (e) {
      // Entered values stay exactly as they are; only the message changes.
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!CARE_PLAN_AUTHOR_ROLES.includes(appRole as (typeof CARE_PLAN_AUTHOR_ROLES)[number])) return null;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={begin}>{mode === "revision" ? "Revise care plan" : "Start care plan"}</Button>
        {sourceForm1823 ? (
          <Button variant="outline" onClick={beginFromForm1823}>
            {mode === "revision" ? "Revise from" : "Start from"} Form 1823 (exam {formatCarePlanDateOnly(sourceForm1823.exam_date)})
          </Button>
        ) : null}
      </div>
    );
  }

  const issueFor = (scope: CarePlanDraftIssue["scope"], field: CarePlanDraftIssue["field"]) =>
    attempted ? issues.find((issue) => issue.scope === scope && issue.field === field) : undefined;
  const planIssues = issues.filter((issue) => issue.scope === "plan");
  const showAttribution = [residentName, facilityName].filter(Boolean).join(" · ");

  return (
    <section aria-labelledby="care-plan-editor-heading" className="max-w-[880px] rounded-[var(--radius)] border border-border bg-card">
      <fieldset disabled={busy} className="contents">
        <div className="space-y-2 px-5 pt-5">
          <h2 id="care-plan-editor-heading" ref={headingRef} tabIndex={-1} className="text-[18px] font-semibold leading-snug text-foreground outline-none">
            {copy.heading}
          </h2>
          {showAttribution ? <p className="text-[13px] text-muted-foreground">{showAttribution}</p> : null}
          <p className="text-sm text-foreground">{copy.intro}</p>
          {sourceId && sourceForm1823 ? (
            <div className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
              <p className="font-medium">
                Drafted from Form 1823 exam {formatCarePlanDateOnly(sourceForm1823.exam_date)}. Every line is yours to change; the 1823 informs the plan, it does not write it.
              </p>
              <p className="mt-1 text-[13px]">
                Dates were filled as today and {DEFAULT_REVIEW_MONTHS} months out; change either to what this plan needs.
              </p>
              {gaps.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {gaps.map((gap, i) => (
                    <li key={i}>{gap.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1">The 1823 left no open judgments.</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 px-5 pt-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FormLabel htmlFor="care-plan-effective" required>Effective date</FormLabel>
            <DateInput id="care-plan-effective" value={effective} onValueChange={setEffective} emptyHint={null} aria-invalid={Boolean(issueFor("plan", "effective"))} aria-describedby="care-plan-effective-help" className="max-w-[220px]" />
            <p id="care-plan-effective-help" className={cn("text-[12px]", issueFor("plan", "effective") ? "font-medium text-foreground" : "text-muted-foreground")}>{issueFor("plan", "effective")?.message ?? CARE_PLAN_EFFECTIVE_DATE_HELP}</p>
          </div>
          <div className="space-y-1.5">
            <FormLabel htmlFor="care-plan-review" required>Review due</FormLabel>
            <DateInput id="care-plan-review" value={review} onValueChange={setReview} emptyHint={null} aria-invalid={Boolean(issueFor("plan", "review"))} aria-describedby="care-plan-review-help" className="max-w-[220px]" />
            <p id="care-plan-review-help" className={cn("text-[12px]", issueFor("plan", "review") ? "font-medium text-foreground" : "text-muted-foreground")}>
              {issueFor("plan", "review")?.message ?? CARE_PLAN_REVIEW_DUE_HELP}
            </p>
          </div>
        </div>

        <div className="space-y-3 px-5 pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-foreground">Needs</h3>
            <p className="text-[12px] text-muted-foreground">
              {lines.length === 0 ? "No needs yet" : `${lines.length} need${lines.length === 1 ? "" : "s"}`}
              {mode === "revision" ? ` · ${formatCarePlanChangeSummary(changes)}` : ""}
            </p>
          </div>

          {removed.map(({ line }) => (
            <div key={line.key} role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-muted px-3 py-2 text-[13px] text-foreground">
              <span>
                Removed <span className="font-medium">{line.title.trim() || "an untitled need"}</span>
                {line.sourceId ? " from this revision" : ""}. {mode === "revision" ? "The current plan is unchanged until this version is signed." : ""}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => undoRemove(line.key)}>
                <Undo2 aria-hidden /> Undo
              </Button>
            </div>
          ))}

          {lines.map((line, index) => {
            const isOpen = expanded.has(line.key);
            const summary = summarizeCarePlanNeed(line, index);
            const lineIssues = issues.filter((issue) => issue.scope === index);
            const fieldIssue = (field: CarePlanNeedField) => issueFor(index, field);
            const fieldId = (field: CarePlanNeedField) => `need-${line.key}-${field}`;
            return (
              <div key={line.key} className="rounded-[var(--radius)] border border-border bg-background">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`need-${line.key}-panel`}
                    onClick={() => toggle(line.key)}
                    className="flex min-h-[36px] min-w-0 flex-1 items-center gap-2 rounded-[var(--radius)] text-left text-[13px] font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {isOpen ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="truncate">{summary}</span>
                    {!isOpen && attempted && lineIssues.length > 0 ? (
                      <span className="shrink-0 text-[12px] font-normal text-muted-foreground">{lineIssues.length} missing</span>
                    ) : null}
                  </button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(index)}>
                    {line.sourceId ? "Remove from this revision" : "Discard"}
                  </Button>
                </div>

                {isOpen ? (
                  <div id={`need-${line.key}-panel`} className="space-y-5 border-t border-border px-4 pb-4 pt-3">
                    <div className="space-y-3">
                      <p className="text-[12px] font-semibold text-muted-foreground">Need and goal</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field id={fieldId("category")} label={CARE_PLAN_FIELD_LABELS.category} help={CARE_PLAN_FIELD_HELP.category} issue={fieldIssue("category")?.message} required>
                          <select id={fieldId("category")} value={line.category} onChange={(e) => patch(line.key, "category", e.target.value)} aria-invalid={Boolean(fieldIssue("category"))} aria-describedby={`${fieldId("category")}-help`} className={NATIVE_SELECT_CLASS}>
                            <option value="">Choose category</option>
                            {Object.entries(CARE_PLAN_CATEGORY_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </Field>
                        <Field id={fieldId("assistance_level")} label={CARE_PLAN_FIELD_LABELS.assistance_level} help={CARE_PLAN_FIELD_HELP.assistance_level} issue={fieldIssue("assistance_level")?.message} required>
                          <select id={fieldId("assistance_level")} value={line.assistance_level} onChange={(e) => patch(line.key, "assistance_level", e.target.value)} aria-invalid={Boolean(fieldIssue("assistance_level"))} aria-describedby={`${fieldId("assistance_level")}-help`} className={NATIVE_SELECT_CLASS}>
                            <option value="">Choose assistance level</option>
                            {Object.entries(CARE_PLAN_ASSISTANCE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <Field id={fieldId("title")} label={CARE_PLAN_FIELD_LABELS.title} help={CARE_PLAN_FIELD_HELP.title} issue={fieldIssue("title")?.message} required>
                        <Input id={fieldId("title")} value={line.title} onChange={(e) => patch(line.key, "title", e.target.value)} aria-invalid={Boolean(fieldIssue("title"))} aria-describedby={`${fieldId("title")}-help`} className="max-w-[480px]" />
                      </Field>
                      <Field id={fieldId("description")} label={CARE_PLAN_FIELD_LABELS.description} help={CARE_PLAN_FIELD_HELP.description} issue={fieldIssue("description")?.message} required>
                        <Textarea id={fieldId("description")} value={line.description} onChange={(e) => patch(line.key, "description", e.target.value)} aria-invalid={Boolean(fieldIssue("description"))} aria-describedby={`${fieldId("description")}-help`} rows={3} />
                      </Field>
                      <Field id={fieldId("goal")} label={CARE_PLAN_FIELD_LABELS.goal} help={CARE_PLAN_FIELD_HELP.goal}>
                        <Textarea id={fieldId("goal")} value={line.goal} onChange={(e) => patch(line.key, "goal", e.target.value)} aria-describedby={`${fieldId("goal")}-help`} rows={2} />
                      </Field>
                    </div>

                    <div className="space-y-3">
                      <p className="text-[12px] font-semibold text-muted-foreground">Support and interventions</p>
                      <Field id={fieldId("interventions")} label={CARE_PLAN_FIELD_LABELS.interventions} help={CARE_PLAN_FIELD_HELP.interventions}>
                        <Textarea id={fieldId("interventions")} value={line.interventions.join("\n")} onChange={(e) => patch(line.key, "interventions", e.target.value.split("\n"))} aria-describedby={`${fieldId("interventions")}-help`} rows={4} />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field id={fieldId("frequency")} label={CARE_PLAN_FIELD_LABELS.frequency} help={CARE_PLAN_FIELD_HELP.frequency}>
                          <Input id={fieldId("frequency")} value={line.frequency} onChange={(e) => patch(line.key, "frequency", e.target.value)} aria-describedby={`${fieldId("frequency")}-help`} />
                        </Field>
                      </div>
                      <Field id={fieldId("special_instructions")} label={`${CARE_PLAN_FIELD_LABELS.special_instructions} (optional)`} help={CARE_PLAN_FIELD_HELP.special_instructions}>
                        <Textarea id={fieldId("special_instructions")} value={line.special_instructions} onChange={(e) => patch(line.key, "special_instructions", e.target.value)} aria-describedby={`${fieldId("special_instructions")}-help`} rows={2} />
                      </Field>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          <Button id="care-plan-add-need" type="button" variant="outline" onClick={addLine}>
            <Plus aria-hidden /> Add another need
          </Button>
        </div>

        <div className="space-y-1.5 px-5 pt-6">
          <FormLabel htmlFor="care-plan-notes">{copy.notesLabel}</FormLabel>
          <Textarea id="care-plan-notes" value={notes} onChange={(e) => setNotes(e.target.value)} aria-describedby="care-plan-notes-help" rows={3} />
          <p id="care-plan-notes-help" className="text-[12px] text-muted-foreground">{copy.notesHelp}</p>
        </div>

        {mode === "revision" && changes.rows.some((row) => row.kind !== "unchanged") ? (
          <div className="px-5 pt-5">
            <p className="text-[12px] font-semibold text-muted-foreground">Changes in this revision</p>
            <ul className="mt-1 space-y-0.5 text-[13px] text-foreground">
              {changes.rows
                .filter((row) => row.kind !== "unchanged")
                .map((row, i) => (
                  <li key={`${row.kind}-${row.label}-${i}`}>
                    <span className="text-muted-foreground">{row.kind === "added" ? "Added" : row.kind === "modified" ? "Changed" : "Removed"}</span> · {row.label}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        <div aria-label="Save for clinical review" className="sticky bottom-0 z-10 mt-6 rounded-b-[var(--radius)] border-t border-border bg-background px-5 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1 text-[13px]">
              <p className={cn("font-medium", dirty ? "text-foreground" : "text-muted-foreground")} aria-live="polite">
                {dirty ? "Unsaved changes" : "No changes yet"}
              </p>
              {/* On a phone the intro above carries this meaning; the bar stays short. */}
              <p className="hidden text-[12px] text-muted-foreground sm:block">{CARE_PLAN_SAVE_MEANING_COPY}</p>
              {attempted && issues.length > 0 ? (
                <div role="alert" className="text-[13px] text-foreground">
                  <p className="font-medium">Before this can be saved:</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {planIssues.map((issue) => (
                      <li key={`${issue.scope}-${issue.field}`}>{issue.message}</li>
                    ))}
                    {issues.filter((issue) => issue.scope !== "plan").slice(0, 4).map((issue) => (
                      <li key={`${issue.scope}-${issue.field}`}>{issue.message}</li>
                    ))}
                    {issues.filter((issue) => issue.scope !== "plan").length > 4 ? <li>And more in the needs above.</li> : null}
                  </ul>
                </div>
              ) : null}
              {error ? (
                <p role="alert" className="text-[13px] font-medium text-foreground">
                  {error} Your entries are still here.
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2 sm:justify-end">
              <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
              <Button type="button" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : copy.action}
              </Button>
            </div>
          </div>
        </div>
      </fieldset>
    </section>
  );
}

function Field({
  id,
  label,
  help,
  issue,
  required,
  children,
}: {
  id: string;
  label: string;
  help: string;
  issue?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <FormLabel htmlFor={id} required={required}>{label}</FormLabel>
      {children}
      <p id={`${id}-help`} className={cn("text-[12px]", issue ? "font-medium text-foreground" : "text-muted-foreground")}>
        {issue ?? help}
      </p>
    </div>
  );
}
