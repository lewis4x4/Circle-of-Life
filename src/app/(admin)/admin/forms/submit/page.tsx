"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ClipboardList, Loader2, Send } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  categoryLabel,
  parseFields,
  type InternalFormTemplateRow,
  type QueryError,
  type QueryResult,
} from "@/lib/office/internal-forms";
import { fetchActorContext } from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

export default function AdminSubmitInternalFormPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [templates, setTemplates] = useState<InternalFormTemplateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
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
      const q = supabase
        .from("internal_form_templates" as never)
        .select("id, name, description, category, fields, is_active, created_at")
        .eq("facility_id", selectedFacilityId as string)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name");
      const res = (await q) as unknown as QueryResult<InternalFormTemplateRow>;
      const err: QueryError | null = res.error;
      if (err) throw new Error(err.message);
      setTemplates((res.data ?? []).map((t) => ({ ...t, fields: parseFields(t.fields) })));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load forms.");
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

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const missingRequired = useMemo(() => {
    if (!template) return [];
    return template.fields.filter((f) => f.required && !(values[f.key] ?? "").trim());
  }, [template, values]);

  const submit = useCallback(async () => {
    if (!template || missingRequired.length > 0) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const cleaned: Record<string, string> = {};
      for (const f of template.fields) {
        const v = (values[f.key] ?? "").trim();
        if (v) cleaned[f.key] = v;
      }
      const { error } = await supabase.from("internal_form_submissions" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        template_id: template.id,
        template_name: template.name,
        category: template.category,
        values: cleaned,
        submitted_by: actor.userId,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      router.push("/admin/forms");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to submit the form.");
      setSubmitting(false);
    }
  }, [supabase, template, missingRequired, values, selectedFacilityId, router]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-3xl">
        <header className="mb-6 space-y-2">
          <Link
            href="/admin/forms"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Internal forms
          </Link>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-info shrink-0" aria-hidden />
            Fill out a form
          </h2>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first.
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
          <div className="space-y-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Form
              </span>
              <select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setValues({});
                }}
                className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Select a form…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({categoryLabel(t.category)})
                  </option>
                ))}
              </select>
            </label>

            {template ? (
              <div className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-4">
                {template.description ? (
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                ) : null}
                {template.fields.map((field) => (
                  <label key={field.key} className="flex flex-col gap-1 text-sm">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {field.label}
                      {field.required ? <span className="text-danger"> *</span> : null}
                    </span>
                    {field.type === "textarea" ? (
                      <textarea
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValue(field.key, e.target.value)}
                        rows={4}
                        className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                      />
                    ) : field.type === "select" ? (
                      <select
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValue(field.key, e.target.value)}
                        className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                      >
                        <option value="">Select…</option>
                        {field.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValue(field.key, e.target.value)}
                        className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                      />
                    )}
                  </label>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    disabled={submitting || missingRequired.length > 0}
                    onClick={() => void submit()}
                    className="gap-2"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden />
                    )}
                    Submit
                  </Button>
                  <Link
                    href="/admin/forms"
                    className={cn(buttonVariants({ variant: "ghost" }), "text-sm")}
                  >
                    Cancel
                  </Link>
                </div>
                {missingRequired.length > 0 ? (
                  <p className="text-xs text-warning">
                    Required: {missingRequired.map((f) => f.label).join(", ")}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {templates.length === 0
                  ? "No active forms for this facility yet — build one on the hub."
                  : "Select a form to fill out."}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
