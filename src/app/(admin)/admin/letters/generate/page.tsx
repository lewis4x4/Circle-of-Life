"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Loader2, Printer } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  buildLetterPrintHtml,
  buildMergeValues,
  fetchFacilityLetterhead,
  renderLetterBody,
  type FacilityLetterhead,
  type LetterTemplateRow,
  type QueryError,
  type QueryResult,
  type ResidentMergeSource,
  type StaffMergeSource,
} from "@/lib/office/letters";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

type ResidentOption = ResidentMergeSource & { id: string };
type StaffOption = StaffMergeSource & { id: string };

export default function AdminGenerateLetterPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [templates, setTemplates] = useState<LetterTemplateRow[]>([]);
  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [letterhead, setLetterhead] = useState<FacilityLetterhead | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState<string>("");
  const [subjectId, setSubjectId] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const fromQuery = searchParams.get("template");
    if (fromQuery) setTemplateId(fromQuery);
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const templatesQ = supabase
        .from("letter_templates" as never)
        .select("id, name, category, subject_kind, body, created_at")
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("name");
      const residentsQ = supabase
        .from("residents")
        .select(
          "id, first_name, last_name, date_of_birth, admission_date, monthly_total_rate, emergency_contact_1_name",
        )
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("last_name");
      const staffQ = supabase
        .from("user_profiles")
        .select("id, full_name, job_title, email, phone")
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("full_name");

      const [tplRes, resRes, staffRes, head] = await Promise.all([
        templatesQ as unknown as Promise<QueryResult<LetterTemplateRow>>,
        residentsQ as unknown as Promise<QueryResult<ResidentOption>>,
        staffQ as unknown as Promise<QueryResult<StaffOption>>,
        fetchFacilityLetterhead(supabase, selectedFacilityId as string),
      ]);
      const err: QueryError | null = tplRes.error ?? resRes.error ?? staffRes.error;
      if (err) throw new Error(err.message);
      setTemplates(tplRes.data ?? []);
      setResidents(resRes.data ?? []);
      setStaff(staffRes.data ?? []);
      setLetterhead(head);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load letter sources.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  const selectedResident = useMemo(
    () => (template?.subject_kind === "resident" ? residents.find((r) => r.id === subjectId) ?? null : null),
    [template, residents, subjectId],
  );
  const selectedStaff = useMemo(
    () => (template?.subject_kind === "staff" ? staff.find((s) => s.id === subjectId) ?? null : null),
    [template, staff, subjectId],
  );

  const subjectMissing =
    !!template && template.subject_kind !== "none" && !selectedResident && !selectedStaff;

  const mergeValues = useMemo(() => {
    if (!letterhead) return null;
    return buildMergeValues({
      facility: letterhead,
      resident: selectedResident,
      staff: selectedStaff,
    });
  }, [letterhead, selectedResident, selectedStaff]);

  const renderedBody = useMemo(() => {
    if (!template || !mergeValues) return "";
    return renderLetterBody(template.body, mergeValues);
  }, [template, mergeValues]);

  const recipientName = selectedResident
    ? `${selectedResident.first_name} ${selectedResident.last_name}`.trim()
    : selectedStaff?.full_name ?? null;

  const generateAndLog = useCallback(async () => {
    if (!template || !letterhead || !mergeValues || subjectMissing) return;
    setGenerating(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("generated_letters" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        template_id: template.id,
        template_name: template.name,
        category: template.category,
        resident_id: selectedResident?.id ?? null,
        staff_user_id: selectedStaff?.id ?? null,
        recipient_name: recipientName,
        rendered_body: renderedBody,
        merge_values: mergeValues,
        generated_by: actor.userId,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);

      const html = buildLetterPrintHtml({
        facility: letterhead,
        renderedBody,
        templateName: template.name,
      });
      const win = window.open("", "_blank", "noopener,noreferrer");
      if (win) {
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
      }
      router.push("/admin/letters");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to generate the letter.");
      setGenerating(false);
    }
  }, [
    supabase,
    template,
    letterhead,
    mergeValues,
    subjectMissing,
    selectedFacilityId,
    selectedResident,
    selectedStaff,
    recipientName,
    renderedBody,
    router,
  ]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-6 space-y-2">
          <Link
            href="/admin/letters"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Letters & documents
          </Link>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <FileText className="h-8 w-8 text-info shrink-0" aria-hidden />
            Generate a letter
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Pick a template and subject; the merge preview updates live. Generating logs the
            rendered copy to the file and opens the print view (print to PDF).
          </p>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — letters render on that facility&apos;s letterhead.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
            <div className="space-y-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Template
                </span>
                <select
                  value={templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    setSubjectId("");
                  }}
                  className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select a template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>

              {template?.subject_kind === "resident" ? (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Resident
                  </span>
                  <select
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="">Select a resident…</option>
                    {residents.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.last_name}, {r.first_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {template?.subject_kind === "staff" ? (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Staff member
                  </span>
                  <select
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="">Select a staff member…</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                        {s.job_title ? ` — ${s.job_title}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No templates for this facility yet —{" "}
                  <Link href="/admin/letters" className="underline">
                    create one on the hub
                  </Link>
                  .
                </p>
              ) : null}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  disabled={!template || subjectMissing || generating}
                  onClick={() => void generateAndLog()}
                  className="gap-2"
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Printer className="h-4 w-4" aria-hidden />
                  )}
                  Generate, log & print
                </Button>
                <Link
                  href="/admin/letters"
                  className={cn(buttonVariants({ variant: "ghost" }), "text-sm")}
                >
                  Cancel
                </Link>
              </div>
              {subjectMissing ? (
                <p className="text-xs text-warning">
                  This template merges {template?.subject_kind} fields — pick a{" "}
                  {template?.subject_kind} first.
                </p>
              ) : null}
            </div>

            <section aria-labelledby="letter-preview-heading" className="space-y-2">
              <h3
                id="letter-preview-heading"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Preview
              </h3>
              <div className="rounded-[var(--radius)] border border-border bg-card p-6 min-h-[320px]">
                {template && letterhead ? (
                  <div className="space-y-4">
                    <div className="border-b border-border pb-3">
                      <p className="text-lg font-semibold text-foreground">{letterhead.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          letterhead.address_line_1,
                          letterhead.address_line_2,
                          `${letterhead.city}, ${letterhead.state} ${letterhead.zip}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <pre className="whitespace-pre-wrap font-serif text-sm text-foreground leading-relaxed">
                      {renderedBody}
                    </pre>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select a template to see the merged preview.
                  </p>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
