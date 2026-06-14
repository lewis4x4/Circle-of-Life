"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookCheck, Loader2, Plus } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  BINDER_CATEGORIES,
  binderCategoryLabel,
  binderStatusTone,
  fetchBinderEvidence,
  type BinderCategory,
  type BinderEvidence,
  type BinderItemRow,
  type BinderStatus,
} from "@/lib/office/survey-binder";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

const STATUS_OPTIONS: { id: BinderStatus; label: string }[] = [
  { id: "ready", label: "Ready" },
  { id: "in_progress", label: "In progress" },
  { id: "missing", label: "Missing" },
  { id: "not_applicable", label: "N/A" },
];

export default function AdminSurveyBinderPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [items, setItems] = useState<BinderItemRow[]>([]);
  const [evidence, setEvidence] = useState<BinderEvidence | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<BinderCategory>("admin_records");
  const [sourceUrl, setSourceUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setItems([]);
      setEvidence(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const fid = selectedFacilityId as string;
      const itemsRes = (await supabase
        .from("survey_binder_items" as never)
        .select("id, category, title, status, note, source_url, sort_order")
        .eq("facility_id", fid)
        .is("deleted_at", null)
        .order("category")
        .order("sort_order")
        .order("title")
        .limit(500)) as unknown as QueryResult<BinderItemRow>;
      if (itemsRes.error) throw new Error(itemsRes.error.message);
      setItems(itemsRes.data ?? []);
      setEvidence(await fetchBinderEvidence(supabase, fid));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load the survey binder.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, facilityReady, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addItem = useCallback(async () => {
    if (!facilityReady || !title.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("survey_binder_items" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        category,
        title: title.trim(),
        status: "in_progress",
        source_url: sourceUrl.trim() || null,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setTitle("");
      setSourceUrl("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to add the binder item.");
    } finally {
      setSaving(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, category, title, sourceUrl, load]);

  const setStatus = useCallback(
    async (row: BinderItemRow, status: BinderStatus) => {
      setBusyId(row.id);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        const { error } = await supabase
          .from("survey_binder_items" as never)
          .update({ status, updated_by: actor?.userId ?? null } as never)
          .eq("id", row.id);
        if (error) throw new Error(error.message);
        setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, status } : it)));
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to update status.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, BinderItemRow[]>();
    for (const it of items) {
      const list = map.get(it.category) ?? [];
      list.push(it);
      map.set(it.category, list);
    }
    return map;
  }, [items]);

  const readyCount = useMemo(() => items.filter((i) => i.status === "ready").length, [items]);
  const missingCount = useMemo(() => items.filter((i) => i.status === "missing").length, [items]);

  const inputCls = "rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground";

  const kpis = evidence
    ? [
        { label: "Facility documents", value: evidence.documentCount },
        { label: "Expiring ≤60d", value: evidence.expiringSoonCount, warn: evidence.expiringSoonCount > 0 },
        { label: "In-services YTD", value: evidence.inservicesThisYear },
        { label: "Drills due ≤60d", value: evidence.drillsDueSoon, warn: evidence.drillsDueSoon > 0 },
      ]
    : [];

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-2">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <BookCheck className="h-8 w-8 text-info shrink-0" aria-hidden />
            Survey-readiness binder
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            AHCA inspection evidence at a glance. {readyCount} ready · {missingCount} missing across{" "}
            {items.length} tracked item{items.length === 1 ? "" : "s"}.
          </p>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — the binder is per-facility.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {facilityReady && evidence ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-[var(--radius)] border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className={`text-2xl font-semibold ${k.warn ? "text-warning" : "text-foreground"}`}>{k.value}</p>
              </div>
            ))}
            <div className="rounded-[var(--radius)] border border-border bg-card px-4 py-3 sm:col-span-2 lg:col-span-4">
              <p className="text-xs text-muted-foreground">Last survey on record</p>
              {evidence.lastSurvey ? (
                <p className="text-sm text-foreground">
                  {evidence.lastSurvey.date} · {evidence.lastSurvey.type.replace(/_/g, " ")} ·{" "}
                  {evidence.lastSurvey.result.replace(/_/g, " ")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No survey history recorded.</p>
              )}
            </div>
          </div>
        ) : null}

        {facilityReady ? (
          <div className="grid gap-2 rounded-[var(--radius)] border border-border bg-card p-4 lg:grid-cols-4">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Binder line item…"
              aria-label="Binder item title"
              className={`${inputCls} lg:col-span-2`}
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as BinderCategory)}
              aria-label="Category"
              className={inputCls}
            >
              {BINDER_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="Internal link (optional)"
              aria-label="Source link"
              className={inputCls}
            />
            <Button type="button" disabled={saving || !title.trim()} onClick={() => void addItem()} className="gap-2 lg:col-span-4">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              Add item
            </Button>
          </div>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError ? (
          items.length === 0 ? (
            <p className="text-sm text-muted-foreground pl-2">
              No binder items yet. Add the records your surveyor always asks for.
            </p>
          ) : (
            <div className="space-y-6">
              {BINDER_CATEGORIES.filter((c) => grouped.has(c.id)).map((c) => (
                <section key={c.id} className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">{binderCategoryLabel(c.id)}</h3>
                  <ul className="space-y-2">
                    {(grouped.get(c.id) ?? []).map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-col gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-sm text-foreground">{row.title}</span>
                          {row.source_url ? (
                            <a
                              href={row.source_url}
                              className="text-xs text-info underline-offset-2 hover:underline truncate"
                            >
                              {row.source_url}
                            </a>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusPill tone={binderStatusTone(row.status)}>
                            {row.status.replace(/_/g, " ")}
                          </StatusPill>
                          <select
                            value={row.status}
                            disabled={busyId === row.id}
                            onChange={(e) => void setStatus(row, e.target.value as BinderStatus)}
                            aria-label={`Status for ${row.title}`}
                            className={inputCls}
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
