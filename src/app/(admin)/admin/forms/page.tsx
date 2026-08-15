"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2, Plus, Trash2 } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  categoryLabel,
  FIELD_TYPES,
  fieldKeyFromLabel,
  INTERNAL_FORM_CATEGORIES,
  parseFields,
  submissionStatusTone,
  type InternalFormCategory,
  type InternalFormField,
  type InternalFormFieldType,
  type InternalFormSubmissionRow,
  type InternalFormTemplateRow,
  type QueryError,
  type QueryResult,
  type SubmissionStatus,
} from "@/lib/office/internal-forms";
import { formatAdminFormFieldValue } from "@/lib/admin/forms/forms-display-copy";
import { fetchActorContext } from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type DraftField = InternalFormField & { optionsText: string };

const STATUS_FILTERS: { id: "all" | SubmissionStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "submitted", label: "Submitted" },
  { id: "in_progress", label: "In progress" },
  { id: "resolved", label: "Resolved" },
  { id: "rejected", label: "Rejected" },
];

export default function AdminInternalFormsPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [templates, setTemplates] = useState<InternalFormTemplateRow[]>([]);
  const [submissions, setSubmissions] = useState<InternalFormSubmissionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showBuilder, setShowBuilder] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState<InternalFormCategory>("maintenance");
  const [draftFields, setDraftFields] = useState<DraftField[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [statusFilter, setStatusFilter] = useState<"all" | SubmissionStatus>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolutionDraft, setResolutionDraft] = useState("");
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setTemplates([]);
      setSubmissions([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const templatesQ = supabase
        .from("internal_form_templates" as never)
        .select("id, name, description, category, fields, is_active, created_at")
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("name");
      const submissionsQ = supabase
        .from("internal_form_submissions" as never)
        .select(
          "id, template_id, template_name, category, values, status, resolution_notes, resolved_at, submitted_by, submitted_at",
        )
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("submitted_at", { ascending: false })
        .limit(200);
      const [tplRes, subRes] = await Promise.all([
        templatesQ as unknown as Promise<QueryResult<InternalFormTemplateRow>>,
        submissionsQ as unknown as Promise<QueryResult<InternalFormSubmissionRow>>,
      ]);
      const err: QueryError | null = tplRes.error ?? subRes.error;
      if (err) throw new Error(err.message);
      setTemplates(
        (tplRes.data ?? []).map((t) => ({ ...t, fields: parseFields(t.fields) })),
      );
      setSubmissions(subRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load internal forms.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const addDraftField = useCallback(() => {
    setDraftFields((prev) => [
      ...prev,
      { key: "", label: "", type: "text", required: false, options: [], optionsText: "" },
    ]);
  }, []);

  const updateDraftField = useCallback((index: number, patch: Partial<DraftField>) => {
    setDraftFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }, []);

  const removeDraftField = useCallback((index: number) => {
    setDraftFields((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const builderValid =
    formName.trim().length > 0 &&
    draftFields.length > 0 &&
    draftFields.every(
      (f) =>
        f.label.trim().length > 0 &&
        (f.type !== "select" || f.optionsText.trim().length > 0),
    );

  const saveTemplate = useCallback(async () => {
    if (!facilityReady || !builderValid) return;
    setSavingTemplate(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const taken = new Set<string>();
      const fields: InternalFormField[] = draftFields.map((f) => {
        const key = fieldKeyFromLabel(f.label, taken);
        taken.add(key);
        return {
          key,
          label: f.label.trim(),
          type: f.type,
          required: f.required,
          options:
            f.type === "select"
              ? f.optionsText
                  .split("\n")
                  .map((o) => o.trim())
                  .filter(Boolean)
              : [],
        };
      });
      const { error } = await supabase.from("internal_form_templates" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        name: formName.trim(),
        description: formDescription.trim() || null,
        category: formCategory,
        fields,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setFormName("");
      setFormDescription("");
      setDraftFields([]);
      setShowBuilder(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to save the form.");
    } finally {
      setSavingTemplate(false);
    }
  }, [
    supabase,
    facilityReady,
    builderValid,
    draftFields,
    formName,
    formDescription,
    formCategory,
    selectedFacilityId,
    load,
  ]);

  const setSubmissionStatus = useCallback(
    async (submission: InternalFormSubmissionRow, status: SubmissionStatus) => {
      setStatusBusyId(submission.id);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        if (!actor) throw new Error("Could not resolve your profile.");
        const terminal = status === "resolved" || status === "rejected";
        const { error } = await supabase
          .from("internal_form_submissions" as never)
          .update({
            status,
            resolution_notes: terminal ? resolutionDraft.trim() || null : submission.resolution_notes,
            resolved_at: terminal ? new Date().toISOString() : null,
            resolved_by: terminal ? actor.userId : null,
            updated_by: actor.userId,
          } as never)
          .eq("id", submission.id);
        if (error) throw new Error(error.message);
        setResolutionDraft("");
        setExpandedId(null);
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to update the submission.");
      } finally {
        setStatusBusyId(null);
      }
    },
    [supabase, resolutionDraft, load],
  );

  const visibleSubmissions = useMemo(
    () =>
      statusFilter === "all"
        ? submissions
        : submissions.filter((s) => s.status === statusFilter),
    [submissions, statusFilter],
  );

  const openCount = useMemo(
    () => submissions.filter((s) => s.status === "submitted" || s.status === "in_progress").length,
    [submissions],
  );

  const templateById = useMemo(() => {
    const map = new Map<string, InternalFormTemplateRow>();
    for (const t of templates) map.set(t.id, t);
    return map;
  }, [templates]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <ClipboardList className="h-8 w-8 text-info shrink-0" aria-hidden />
              Internal forms
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Admin-built forms — maintenance requests, supply requests, grievance intake, refund
              requests. Submissions route to this status-tracked queue.
              {openCount > 0 ? ` ${openCount} open.` : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-2 font-medium text-[10px] uppercase tracking-wider"
            onClick={() => setShowBuilder((v) => !v)}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {showBuilder ? "Close builder" : "New form"}
          </Button>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — forms and their queues are per-facility.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {facilityReady && showBuilder ? (
          <section
            aria-labelledby="form-builder-heading"
            className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-4"
          >
            <h3 id="form-builder-heading" className="text-lg font-semibold text-foreground">
              New form
            </h3>
            <div className="grid gap-3 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Form name
                </span>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Maintenance request"
                  className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Category
                </span>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as InternalFormCategory)}
                  className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {INTERNAL_FORM_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Description (optional)
                </span>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Shown to staff above the form"
                  className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Fields
              </p>
              {draftFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">No fields yet — add at least one.</p>
              ) : null}
              {draftFields.map((field, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-[9px] border border-border bg-background p-3 lg:grid-cols-[1fr_160px_110px_auto]"
                >
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => updateDraftField(index, { label: e.target.value })}
                    placeholder="Field label (e.g. Room / area)"
                    aria-label={`Field ${index + 1} label`}
                    className="rounded-[9px] border border-border bg-card px-3 py-2 text-sm text-foreground"
                  />
                  <select
                    value={field.type}
                    onChange={(e) =>
                      updateDraftField(index, { type: e.target.value as InternalFormFieldType })
                    }
                    aria-label={`Field ${index + 1} type`}
                    className="rounded-[9px] border border-border bg-card px-3 py-2 text-sm text-foreground"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => updateDraftField(index, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove field ${index + 1}`}
                    onClick={() => removeDraftField(index)}
                  >
                    <Trash2 className="h-4 w-4 text-danger" aria-hidden />
                  </Button>
                  {field.type === "select" ? (
                    <textarea
                      value={field.optionsText}
                      onChange={(e) => updateDraftField(index, { optionsText: e.target.value })}
                      rows={3}
                      placeholder={"One dropdown option per line"}
                      aria-label={`Field ${index + 1} options`}
                      className="lg:col-span-4 rounded-[9px] border border-border bg-card px-3 py-2 text-sm text-foreground"
                    />
                  ) : null}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 font-medium text-[10px] uppercase tracking-wider"
                  onClick={addDraftField}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add field
                </Button>
                <Button
                  type="button"
                  disabled={!builderValid || savingTemplate}
                  onClick={() => void saveTemplate()}
                  className="gap-2"
                >
                  {savingTemplate ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Save form
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError ? (
          <>
            <section aria-labelledby="form-templates-heading" className="space-y-3">
              <div className="px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="form-templates-heading" className="text-lg font-semibold text-foreground">
                  Forms
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {templates.length}
                  </span>
                </h3>
              </div>
              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">
                  No forms yet — build one with “New form”.
                </p>
              ) : (
                <ul className="space-y-2">
                  {templates.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-col gap-2 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-semibold text-foreground truncate">{t.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.fields.length} field{t.fields.length === 1 ? "" : "s"}
                          {t.description ? ` · ${t.description}` : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusPill tone="info">{categoryLabel(t.category)}</StatusPill>
                        <Link
                          href={`/admin/forms/submit?template=${t.id}`}
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "font-medium text-[10px] uppercase tracking-wider",
                          )}
                        >
                          Fill out
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="submission-queue-heading" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="submission-queue-heading" className="text-lg font-semibold text-foreground">
                  Submission queue
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {visibleSubmissions.length}
                  </span>
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={statusFilter === f.id}
                      onClick={() => setStatusFilter(f.id)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        statusFilter === f.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground border border-border hover:bg-muted",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {visibleSubmissions.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">
                  No submissions{statusFilter === "all" ? "" : " with this status"} yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {visibleSubmissions.map((s) => {
                    const expanded = expandedId === s.id;
                    const template = templateById.get(s.template_id);
                    const fieldLabel = (key: string) =>
                      template?.fields.find((f) => f.key === key)?.label ?? key.replace(/_/g, " ");
                    return (
                      <li
                        key={s.id}
                        className="rounded-[9px] border border-border bg-card px-[13px] py-2"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedId(expanded ? null : s.id);
                            setResolutionDraft(s.resolution_notes ?? "");
                          }}
                          aria-expanded={expanded}
                          className="flex w-full flex-col gap-2 text-left lg:flex-row lg:items-center lg:justify-between"
                        >
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-semibold text-foreground truncate">
                              {s.template_name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {ET_FMT.format(new Date(s.submitted_at))} ET ·{" "}
                              {categoryLabel(s.category)}
                            </span>
                          </div>
                          <StatusPill tone={submissionStatusTone(s.status)}>
                            {s.status.replace(/_/g, " ")}
                          </StatusPill>
                        </button>

                        {expanded ? (
                          <div className="mt-3 space-y-3 border-t border-border pt-3">
                            <dl className="grid gap-2 lg:grid-cols-2">
                              {Object.entries(s.values).map(([key, value]) => (
                                <div key={key} className="min-w-0">
                                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                    {fieldLabel(key)}
                                  </dt>
                                  <dd className="text-sm text-foreground whitespace-pre-wrap break-words">
                                    {formatAdminFormFieldValue(value)}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                            {s.resolution_notes && s.status !== "submitted" ? (
                              <p className="text-sm text-muted-foreground">
                                Resolution: {s.resolution_notes}
                              </p>
                            ) : null}
                            {s.status === "submitted" || s.status === "in_progress" ? (
                              <div className="space-y-2">
                                <textarea
                                  value={resolutionDraft}
                                  onChange={(e) => setResolutionDraft(e.target.value)}
                                  rows={2}
                                  placeholder="Resolution notes (saved when resolving/rejecting)"
                                  className="w-full rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                  {s.status === "submitted" ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={statusBusyId === s.id}
                                      onClick={() => void setSubmissionStatus(s, "in_progress")}
                                    >
                                      Start work
                                    </Button>
                                  ) : null}
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={statusBusyId === s.id}
                                    onClick={() => void setSubmissionStatus(s, "resolved")}
                                  >
                                    Resolve
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    disabled={statusBusyId === s.id}
                                    onClick={() => void setSubmissionStatus(s, "rejected")}
                                  >
                                    Reject
                                  </Button>
                                  {statusBusyId === s.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
