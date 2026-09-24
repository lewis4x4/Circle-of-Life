"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  formatSeedTargetCoveragePct,
  linkableDocuments,
  seedTargetStatusActions,
  type SeedTargetEffectiveStatus,
} from "@/lib/knowledge/seed-targets-display-copy";

type SeedTarget = {
  id: string;
  workspace_id: string | null;
  topic_slug: string;
  topic_label: string;
  description: string | null;
  sample_questions: string[];
  expected_compliance_category: string | null;
  expected_audience: string | null;
  priority: number;
  status: "uncovered" | "wip" | "covered" | "retired";
  covered_document_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type TargetStatusRow = {
  seed_target_id: string;
  effective_status: SeedTargetEffectiveStatus;
  published_documents: number;
};

type TopicLink = {
  id: string;
  seed_target_id: string;
  document_id: string;
};

type KbDocument = {
  id: string;
  title: string;
  status: string;
  deleted_at: string | null;
};

type CoverageRollup = {
  workspace_id: string;
  covered_count: number;
  wip_count: number;
  uncovered_count: number;
  retired_count: number;
  total_targets: number;
  covered_pct: number | null;
};

/**
 * KB-NEXT-09: owner-curated corpus seed (engineering shell).
 *
 * Read-mostly: lists the global default targets + any org-specific overrides,
 * shows the rollup, and lets owners link published documents to any topic
 * (COL-710). A topic is covered while a linked document is published and not
 * deleted — never by a hand-set status. New org targets can be added via the form at the
 * top. The page is owner/org_admin only — RLS rejects anyone else even if
 * they navigate here.
 */
export default function SeedTargetsRoute() {
  const supabase = useMemo(() => createClient(), []);
  const { user, organizationId, appRole } = useHavenAuth();
  const canEdit = appRole === "owner" || appRole === "org_admin";
  const [targets, setTargets] = useState<SeedTarget[]>([]);
  const [rollup, setRollup] = useState<CoverageRollup | null>(null);
  const [statusById, setStatusById] = useState<Map<string, TargetStatusRow>>(new Map());
  const [links, setLinks] = useState<TopicLink[]>([]);
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "uncovered" | "wip" | "covered" | "retired">("all");

  // New-target form state
  const [newTopic, setNewTopic] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPriority, setNewPriority] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [targetsRes, rollupRes, statusRes, linksRes, docsRes] = await Promise.all([
        supabase
          .from("kb_seed_targets" as never)
          .select("*")
          .order("priority", { ascending: false } as never),
        supabase.from("vw_kb_seed_target_coverage" as never).select("*").maybeSingle(),
        supabase.from("vw_kb_seed_target_status" as never).select("seed_target_id, effective_status, published_documents"),
        supabase
          .from("kb_seed_target_links" as never)
          .select("id, seed_target_id, document_id")
          .is("deleted_at" as never, null as never),
        supabase
          .from("documents" as never)
          .select("id, title, status, deleted_at")
          .is("deleted_at" as never, null as never)
          .order("title" as never, { ascending: true } as never),
      ]);
      if (targetsRes.error) throw targetsRes.error;
      if (statusRes.error) throw statusRes.error;
      if (linksRes.error) throw linksRes.error;
      if (docsRes.error) throw docsRes.error;
      setTargets((targetsRes.data ?? []) as unknown as SeedTarget[]);
      setStatusById(
        new Map(((statusRes.data ?? []) as unknown as TargetStatusRow[]).map((row) => [row.seed_target_id, row])),
      );
      setLinks((linksRes.data ?? []) as unknown as TopicLink[]);
      setDocuments((docsRes.data ?? []) as unknown as KbDocument[]);
      setRollup(!rollupRes.error && rollupRes.data ? (rollupRes.data as unknown as CoverageRollup) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load seed targets");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = useCallback(
    async (id: string, status: SeedTarget["status"]) => {
      const { error: uErr } = await supabase
        .from("kb_seed_targets" as never)
        .update({ status } as never)
        .eq("id" as never, id as never);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await load();
    },
    [supabase, load],
  );

  const linkDocument = useCallback(
    async (targetId: string) => {
      const documentId = linkChoice[targetId];
      if (!documentId || !organizationId) return;
      setError(null);
      const { error: lErr } = await supabase.from("kb_seed_target_links" as never).insert({
        workspace_id: organizationId,
        seed_target_id: targetId,
        document_id: documentId,
      } as never);
      if (lErr) {
        setError(lErr.message);
        return;
      }
      setLinkChoice((prev) => ({ ...prev, [targetId]: "" }));
      await load();
    },
    [linkChoice, organizationId, supabase, load],
  );

  const unlinkDocument = useCallback(
    async (linkId: string) => {
      setError(null);
      const { error: uErr } = await supabase
        .from("kb_seed_target_links" as never)
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq("id" as never, linkId as never);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await load();
    },
    [supabase, load],
  );

  const documentsById = useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents]);

  const effectiveStatus = useCallback(
    (t: SeedTarget): SeedTargetEffectiveStatus => statusById.get(t.id)?.effective_status ?? "uncovered",
    [statusById],
  );

  const addTarget = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newTopic.trim() || !newLabel.trim()) return;
      setSaving(true);
      setError(null);
      try {
        // Owner-only insert — RLS enforces workspace match + role.
        if (!user?.id) {
          setError("Not signed in.");
          return;
        }
        const orgId = organizationId;
        if (!orgId) {
          setError("Profile has no organization");
          return;
        }
        const { error: iErr } = await supabase.from("kb_seed_targets" as never).insert(
          {
            workspace_id: orgId,
            topic_slug: newTopic
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, ""),
            topic_label: newLabel.trim(),
            sample_questions: [],
            priority: Number(newPriority),
          } as never,
        );
        if (iErr) {
          setError(iErr.message);
          return;
        }
        setNewTopic("");
        setNewLabel("");
        setNewPriority("");
        await load();
      } finally {
        setSaving(false);
      }
    },
    [newLabel, newPriority, newTopic, supabase, load, user?.id, organizationId],
  );

  const filtered = useMemo(
    () => (filter === "all" ? targets : targets.filter((t) => effectiveStatus(t) === filter)),
    [targets, filter, effectiveStatus],
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <Link
          href="/admin/knowledge/admin"
          className="text-xs text-muted-foreground hover:text-slate-700 dark:hover:text-zinc-200"
        >
          ← Knowledge admin
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100 mt-2">
          KB Seed Targets
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Topics Haven should be able to answer. Global defaults plus your org-specific additions.
          A topic is <strong>covered</strong> while a published document is linked to it; archive or
          delete the document and the topic is uncovered again. Org topics can be marked{" "}
          <strong>wip</strong> while the document is being written.
        </p>
      </div>

      {rollup ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <Stat label="Covered" value={rollup.covered_count} tone="emerald" />
          <Stat label="WIP" value={rollup.wip_count} tone="amber" />
          <Stat label="Uncovered" value={rollup.uncovered_count} tone="rose" />
          <Stat label="Retired" value={rollup.retired_count} tone="slate" />
          <Stat
            label="Coverage"
            value={formatSeedTargetCoveragePct(rollup.covered_pct)}
            tone="slate"
          />
        </div>
      ) : null}

      <form
        onSubmit={addTarget}
        className="mb-6 rounded border border-slate-200 dark:border-zinc-700 p-4 bg-white dark:bg-zinc-900"
      >
        <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 mb-3">
          Add org-specific target
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input aria-label="Topic slug"
            type="text"
            placeholder="Topic slug (e.g. evacuation_host_list)"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          />
          <input aria-label="Topic label"
            type="text"
            placeholder="Topic label (e.g. Hurricane evacuation host facility list)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            type="number"
            min={0}
            max={100}
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value)}
            aria-label="Priority, 0 to 100"
            placeholder="Priority (0–100, higher first)"
            required
            className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={saving || !newTopic.trim() || !newLabel.trim() || newPriority.trim() === ""}
          className="mt-3 rounded bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add target"}
        </button>
      </form>

      <div className="flex items-center gap-2 mb-3 text-xs">
        {(["all", "uncovered", "wip", "covered", "retired"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={[
              "rounded border px-2 py-1",
              filter === f
                ? "border-slate-900 dark:border-zinc-100 bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-400",
            ].join(" ")}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">
          {filtered.length} of {targets.length}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No targets match this filter.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((t) => (
            <li
              key={t.id}
              className="rounded border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900 dark:text-zinc-100">
                      {t.topic_label}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">{t.topic_slug}</span>
                    {t.workspace_id == null ? (
                      <span className="text-xs rounded border border-slate-300 dark:border-zinc-700 px-1.5 py-0.5 text-muted-foreground">
                        global
                      </span>
                    ) : (
                      <span className="text-xs rounded border border-blue-300 dark:border-blue-700 px-1.5 py-0.5 text-blue-700 dark:text-blue-300">
                        org
                      </span>
                    )}
                    <span
                      className={[
                        "text-xs rounded px-1.5 py-0.5",
                        effectiveStatus(t) === "covered"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
                          : effectiveStatus(t) === "wip"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                            : effectiveStatus(t) === "retired"
                              ? "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300"
                              : "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200",
                      ].join(" ")}
                    >
                      {effectiveStatus(t)}
                    </span>
                    <span className="text-xs text-muted-foreground">priority {t.priority}</span>
                    {t.expected_compliance_category ? (
                      <span className="text-xs rounded border border-slate-300 dark:border-zinc-700 px-1.5 py-0.5 text-muted-foreground">
                        {t.expected_compliance_category}
                      </span>
                    ) : null}
                  </div>
                  {t.description ? (
                    <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">{t.description}</p>
                  ) : null}
                  {t.sample_questions.length > 0 ? (
                    <ul className="mt-2 list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                      {t.sample_questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  ) : null}
                  <TopicLinks
                    topicLabel={t.topic_label}
                    links={links.filter((l) => l.seed_target_id === t.id)}
                    documentsById={documentsById}
                    documents={documents}
                    canEdit={canEdit}
                    choice={linkChoice[t.id] ?? ""}
                    onChoose={(value) => setLinkChoice((prev) => ({ ...prev, [t.id]: value }))}
                    onLink={() => void linkDocument(t.id)}
                    onUnlink={(linkId) => void unlinkDocument(linkId)}
                  />
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {(canEdit
                    ? seedTargetStatusActions({ isGlobal: t.workspace_id == null, storedStatus: t.status })
                    : []
                  ).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => updateStatus(t.id, s)}
                        title={`Mark ${s}`}
                        className="text-xs rounded border border-slate-300 dark:border-zinc-700 px-2 py-1 text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        → {s}
                      </button>
                    ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TopicLinks({
  topicLabel,
  links,
  documentsById,
  documents,
  canEdit,
  choice,
  onChoose,
  onLink,
  onUnlink,
}: {
  topicLabel: string;
  links: TopicLink[];
  documentsById: Map<string, KbDocument>;
  documents: KbDocument[];
  canEdit: boolean;
  choice: string;
  onChoose: (value: string) => void;
  onLink: () => void;
  onUnlink: (linkId: string) => void;
}) {
  const options = linkableDocuments(documents, new Set(links.map((l) => l.document_id)));
  return (
    <div className="mt-2 space-y-1 text-xs">
      {links.length === 0 ? (
        <p className="text-muted-foreground">No document linked.</p>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => {
            const doc = documentsById.get(l.document_id);
            return (
              <li key={l.id} className="flex items-center gap-2">
                <Link
                  href={`/admin/knowledge/documents/${l.document_id}`}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  {doc?.title ?? "Document no longer available"}
                </Link>
                {doc && doc.status !== "published" ? (
                  <span className="text-muted-foreground">({doc.status} — does not count)</span>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => onUnlink(l.id)}
                    className="text-muted-foreground hover:text-foreground underline"
                  >
                    Unlink
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && options.length > 0 ? (
        <div className="flex items-center gap-2">
          <select
            aria-label={`Published document for ${topicLabel}`}
            value={choice}
            onChange={(e) => onChoose(e.target.value)}
            className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1"
          >
            <option value="">Link a published document…</option>
            {options.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!choice}
            onClick={onLink}
            className="rounded border border-slate-300 dark:border-zinc-700 px-2 py-1 disabled:opacity-40"
          >
            Link
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "emerald" | "amber" | "rose" | "slate";
}) {
  const colorClass =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "rose"
          ? "text-rose-600 dark:text-rose-400"
          : "text-slate-700 dark:text-zinc-300";
  return (
    <div className="rounded border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${colorClass}`}>{value}</div>
    </div>
  );
}
