"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSignature, FileText, Loader2, Plus, Printer } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  buildLetterPrintHtml,
  COMMON_MERGE_FIELDS,
  fetchFacilityLetterhead,
  LETTER_CATEGORIES,
  MERGE_FIELD_REFERENCE,
  type GeneratedLetterRow,
  type LetterCategory,
  type LetterSubjectKind,
  type LetterTemplateRow,
  type QueryError,
  type QueryResult,
} from "@/lib/office/letters";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function categoryLabel(id: string): string {
  return LETTER_CATEGORIES.find((c) => c.id === id)?.label ?? id.replace(/_/g, " ");
}

export default function AdminLettersHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [templates, setTemplates] = useState<LetterTemplateRow[]>([]);
  const [letters, setLetters] = useState<GeneratedLetterRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplCategory, setTplCategory] = useState<LetterCategory>("general");
  const [tplSubjectKind, setTplSubjectKind] = useState<LetterSubjectKind>("resident");
  const [tplBody, setTplBody] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setTemplates([]);
      setLetters([]);
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
      const lettersQ = supabase
        .from("generated_letters" as never)
        .select(
          "id, template_name, category, resident_id, staff_user_id, recipient_name, rendered_body, merge_values, generated_at",
        )
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("generated_at", { ascending: false })
        .limit(100);
      const [tplRes, letterRes] = await Promise.all([
        templatesQ as unknown as Promise<QueryResult<LetterTemplateRow>>,
        lettersQ as unknown as Promise<QueryResult<GeneratedLetterRow>>,
      ]);
      const err: QueryError | null = tplRes.error ?? letterRes.error;
      if (err) throw new Error(err.message);
      setTemplates(tplRes.data ?? []);
      setLetters(letterRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load letters.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTemplate = useCallback(async () => {
    if (!facilityReady || !tplName.trim() || !tplBody.trim()) return;
    setSavingTemplate(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("letter_templates" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        name: tplName.trim(),
        category: tplCategory,
        subject_kind: tplSubjectKind,
        body: tplBody,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setTplName("");
      setTplBody("");
      setShowTemplateForm(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to save template.");
    } finally {
      setSavingTemplate(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, tplName, tplCategory, tplSubjectKind, tplBody, load]);

  const reprintLetter = useCallback(
    async (letter: GeneratedLetterRow) => {
      try {
        const facility = await fetchFacilityLetterhead(supabase, selectedFacilityId as string);
        const html = buildLetterPrintHtml({
          facility,
          renderedBody: letter.rendered_body,
          templateName: letter.template_name,
        });
        const win = window.open("", "_blank", "noopener,noreferrer");
        if (!win) return;
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to open print view.");
      }
    },
    [supabase, selectedFacilityId],
  );

  const mergeHints = useMemo(
    () => [...MERGE_FIELD_REFERENCE[tplSubjectKind], ...COMMON_MERGE_FIELDS],
    [tplSubjectKind],
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <FileSignature className="h-8 w-8 text-info shrink-0" aria-hidden />
              Letters & documents
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Mail-merge correspondence on facility letterhead — rate-increase notices, family
              letters, DCF/payee correspondence, employment verification. Every generated letter
              is logged to the resident or employee file.
            </p>
          </div>
          <Link
            href="/admin/letters/generate"
            className={cn(buttonVariants({ variant: "default" }), "shrink-0 gap-2")}
          >
            <FileText className="h-4 w-4" aria-hidden />
            Generate a letter
          </Link>
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
          <>
            <section aria-labelledby="letter-templates-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="letter-templates-heading" className="text-lg font-semibold text-foreground">
                  Templates
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {templates.length}
                  </span>
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 font-medium text-[10px] uppercase tracking-wider"
                  onClick={() => setShowTemplateForm((v) => !v)}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {showTemplateForm ? "Close" : "New template"}
                </Button>
              </div>

              {showTemplateForm ? (
                <div className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-3">
                  <div className="grid gap-3 lg:grid-cols-3">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Template name
                      </span>
                      <input
                        type="text"
                        value={tplName}
                        onChange={(e) => setTplName(e.target.value)}
                        placeholder="e.g. 30-day rate increase notice"
                        className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Category
                      </span>
                      <select
                        value={tplCategory}
                        onChange={(e) => setTplCategory(e.target.value as LetterCategory)}
                        className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                      >
                        {LETTER_CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Merge subject
                      </span>
                      <select
                        value={tplSubjectKind}
                        onChange={(e) => setTplSubjectKind(e.target.value as LetterSubjectKind)}
                        className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                      >
                        <option value="resident">Resident</option>
                        <option value="staff">Staff member</option>
                        <option value="none">None (facility only)</option>
                      </select>
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Body (plain text with merge fields)
                    </span>
                    <textarea
                      value={tplBody}
                      onChange={(e) => setTplBody(e.target.value)}
                      rows={10}
                      placeholder={"{{today}}\n\nDear {{resident.full_name}},\n\n..."}
                      className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground font-mono"
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Available fields:{" "}
                    {mergeHints.map((f) => (
                      <code key={f} className="mr-2 rounded bg-muted px-1 py-0.5">
                        {f}
                      </code>
                    ))}
                  </p>
                  <Button
                    type="button"
                    disabled={savingTemplate || !tplName.trim() || !tplBody.trim()}
                    onClick={() => void createTemplate()}
                    className="gap-2"
                  >
                    {savingTemplate ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    Save template
                  </Button>
                </div>
              ) : null}

              {templates.length === 0 && !showTemplateForm ? (
                <p className="text-sm text-muted-foreground pl-2">
                  No templates yet — create one, then generate letters from it.
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
                          Subject: {t.subject_kind === "none" ? "facility only" : t.subject_kind}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusPill tone="info">{categoryLabel(t.category)}</StatusPill>
                        <Link
                          href={`/admin/letters/generate?template=${t.id}`}
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "font-medium text-[10px] uppercase tracking-wider",
                          )}
                        >
                          Generate
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="generated-letters-heading" className="space-y-3">
              <div className="px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="generated-letters-heading" className="text-lg font-semibold text-foreground">
                  Generated letters
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {letters.length}
                  </span>
                </h3>
              </div>
              {letters.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">
                  Nothing generated yet for this facility.
                </p>
              ) : (
                <ul className="space-y-2">
                  {letters.map((l) => (
                    <li
                      key={l.id}
                      className="flex flex-col gap-2 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-semibold text-foreground truncate">
                          {l.template_name}
                          {l.recipient_name ? ` — ${l.recipient_name}` : ""}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ET_FMT.format(new Date(l.generated_at))} ET ·{" "}
                          {l.resident_id ? "resident file" : l.staff_user_id ? "employee file" : "facility file"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusPill tone="muted">{categoryLabel(l.category)}</StatusPill>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2 font-medium text-[10px] uppercase tracking-wider"
                          onClick={() => void reprintLetter(l)}
                        >
                          <Printer className="h-4 w-4" aria-hidden />
                          Print
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
