"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatSeedTargetCoveragePct } from "@/lib/knowledge/seed-targets-display-copy";

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
 * shows the rollup, and lets owners change status / link covered_document_id
 * / write notes inline. New org targets can be added via the form at the
 * top. The page is owner/org_admin only — RLS rejects anyone else even if
 * they navigate here.
 */
export default function SeedTargetsRoute() {
  const supabase = useMemo(() => createClient(), []);
  const { user, organizationId } = useHavenAuth();
  const [targets, setTargets] = useState<SeedTarget[]>([]);
  const [rollup, setRollup] = useState<CoverageRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "uncovered" | "wip" | "covered" | "retired">("all");

  // New-target form state
  const [newTopic, setNewTopic] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPriority, setNewPriority] = useState(50);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [targetsRes, rollupRes] = await Promise.all([
        supabase
          .from("kb_seed_targets" as never)
          .select("*")
          .order("priority", { ascending: false } as never),
        supabase.from("vw_kb_seed_target_coverage" as never).select("*").maybeSingle(),
      ]);
      if (targetsRes.error) throw targetsRes.error;
      setTargets((targetsRes.data ?? []) as unknown as SeedTarget[]);
      if (!rollupRes.error && rollupRes.data) {
        setRollup(rollupRes.data as unknown as CoverageRollup);
      }
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
            priority: newPriority,
          } as never,
        );
        if (iErr) {
          setError(iErr.message);
          return;
        }
        setNewTopic("");
        setNewLabel("");
        setNewPriority(50);
        await load();
      } finally {
        setSaving(false);
      }
    },
    [newLabel, newPriority, newTopic, supabase, load, user?.id, organizationId],
  );

  const filtered = useMemo(
    () => (filter === "all" ? targets : targets.filter((t) => t.status === filter)),
    [targets, filter],
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <Link
          href="/admin/knowledge/admin"
          className="text-xs text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Knowledge admin
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100 mt-2">
          KB Seed Targets
        </h1>
        <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
          Topics Haven should be able to answer. Global defaults plus your org-specific additions.
          Mark a target <strong>wip</strong> when you start writing the doc; <strong>covered</strong>{" "}
          once the document is published.
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
          <input
            type="text"
            placeholder="Topic slug (e.g. evacuation_host_list)"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
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
            onChange={(e) => setNewPriority(Number(e.target.value))}
            className="rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={saving || !newTopic.trim() || !newLabel.trim()}
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
        <span className="ml-auto text-slate-400">
          {filtered.length} of {targets.length}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No targets match this filter.</p>
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
                    <span className="text-xs text-slate-400 font-mono">{t.topic_slug}</span>
                    {t.workspace_id == null ? (
                      <span className="text-xs rounded border border-slate-300 dark:border-zinc-700 px-1.5 py-0.5 text-slate-500 dark:text-zinc-400">
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
                        t.status === "covered"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
                          : t.status === "wip"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                            : t.status === "retired"
                              ? "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300"
                              : "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200",
                      ].join(" ")}
                    >
                      {t.status}
                    </span>
                    <span className="text-xs text-slate-400">priority {t.priority}</span>
                    {t.expected_compliance_category ? (
                      <span className="text-xs rounded border border-slate-300 dark:border-zinc-700 px-1.5 py-0.5 text-slate-500 dark:text-zinc-400">
                        {t.expected_compliance_category}
                      </span>
                    ) : null}
                  </div>
                  {t.description ? (
                    <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">{t.description}</p>
                  ) : null}
                  {t.sample_questions.length > 0 ? (
                    <ul className="mt-2 list-disc list-inside text-xs text-slate-500 dark:text-zinc-400 space-y-0.5">
                      {t.sample_questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  ) : null}
                  {t.covered_document_id ? (
                    <Link
                      href={`/admin/knowledge/documents/${t.covered_document_id}`}
                      className="mt-2 inline-block text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      View covered document →
                    </Link>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {(["uncovered", "wip", "covered", "retired"] as const)
                    .filter((s) => s !== t.status)
                    .map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => updateStatus(t.id, s)}
                        disabled={t.workspace_id == null}
                        title={
                          t.workspace_id == null ? "Global defaults aren't editable" : `Mark ${s}`
                        }
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
      <div className="text-xs text-slate-500 dark:text-zinc-400">{label}</div>
      <div className={`text-xl font-semibold ${colorClass}`}>{value}</div>
    </div>
  );
}
