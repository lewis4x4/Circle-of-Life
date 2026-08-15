"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  coverageKpiCoveragePctValue,
  coverageKpiOpenGapsValue,
  coverageKpiReviewOverdueValue,
  coverageKpiStaleExpiredValue,
  formatCoverageComplianceCategory,
  formatCoverageDaysSinceRefresh,
  formatCoverageReviewStatus,
} from "@/lib/knowledge/coverage-display-copy";
import { createClient } from "@/lib/supabase/client";

/**
 * KB-NEXT-11: coverage dashboard.
 *
 * Renders three rollups in one read view so owners can see at a glance:
 *   • Seed-target progress (% covered + counts) — feeds the "what should the
 *     KB cover?" plan.
 *   • Open gaps (kb_empty / thumbs_down / low_confidence /
 *     router_no_grounded_source) — feeds "what did the KB fail on this
 *     week?" with frequency-sorted top gaps and a resolve flow.
 *   • Freshness (fresh / stale / expired / review_overdue) with a list of
 *     the stalest docs grouped by compliance category.
 *
 * Data sources (all RLS-safe security_invoker views or RLS-protected
 * tables):
 *   - vw_kb_coverage_dashboard          (one-row rollup)
 *   - knowledge_gaps                    (top open gaps)
 *   - vw_kb_freshness                   (stale documents)
 */

type DashboardRollup = {
  workspace_id: string;
  total_targets: number;
  covered_targets: number;
  wip_targets: number;
  uncovered_targets: number;
  retired_targets: number;
  coverage_pct: number | null;
  open_gaps: number;
  open_gaps_kb_empty: number;
  open_gaps_thumbs_down: number;
  open_gaps_low_confidence: number;
  open_gaps_router_no_source: number;
  resolved_last_30d: number;
  total_documents: number;
  fresh_documents: number;
  stale_documents: number;
  expired_documents: number;
  unknown_freshness: number;
  review_overdue_count: number;
};

type GapRow = {
  id: string;
  question: string;
  frequency: number;
  signal: "kb_empty" | "thumbs_down" | "low_confidence" | "router_no_grounded_source";
  surface: "knowledge_agent" | "haven_insight" | "router" | "other";
  last_asked_at: string;
  intent: string | null;
  resolved: boolean;
};

type FreshnessRow = {
  document_id: string;
  title: string;
  compliance_category: string | null;
  freshness_status: "fresh" | "stale" | "expired" | "unknown";
  days_since_refresh: number | null;
  review_overdue: boolean;
};

type Tab = "overview" | "gaps" | "freshness";

const SIGNAL_LABELS: Record<GapRow["signal"], string> = {
  kb_empty: "No evidence",
  thumbs_down: "Thumbs down",
  low_confidence: "Low confidence",
  router_no_grounded_source: "Router miss",
};

const FRESHNESS_TONE: Record<FreshnessRow["freshness_status"], string> = {
  fresh: "text-emerald-700 bg-emerald-50 border-emerald-200",
  stale: "text-amber-800 bg-amber-50 border-amber-200",
  expired: "text-rose-800 bg-rose-50 border-rose-200",
  unknown: "text-muted-foreground bg-muted/40 border-border",
};

export default function CoverageDashboardRoute() {
  const supabase = useMemo(() => createClient(), []);
  const [rollup, setRollup] = useState<DashboardRollup | null>(null);
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [freshness, setFreshness] = useState<FreshnessRow[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rollupRes, gapsRes, freshRes] = await Promise.all([
        supabase.from("vw_kb_coverage_dashboard" as never).select("*").maybeSingle(),
        supabase
          .from("knowledge_gaps")
          .select("id,question,frequency,signal,surface,last_asked_at,intent,resolved")
          .eq("resolved", false)
          .order("frequency", { ascending: false })
          .limit(50),
        supabase
          .from("vw_kb_freshness" as never)
          .select("document_id,title,compliance_category,freshness_status,days_since_refresh,review_overdue")
          .order("days_since_refresh", { ascending: false } as never)
          .limit(50),
      ]);
      if (rollupRes.error) throw rollupRes.error;
      if (gapsRes.error) throw gapsRes.error;
      if (freshRes.error) throw freshRes.error;
      setRollup((rollupRes.data ?? null) as unknown as DashboardRollup | null);
      setGaps((gapsRes.data ?? []) as unknown as GapRow[]);
      setFreshness((freshRes.data ?? []) as unknown as FreshnessRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load coverage dashboard");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpiCtx = useMemo(() => ({ loadFailed: Boolean(error) }), [error]);

  const resolveGap = useCallback(
    async (gapId: string) => {
      const { error: uErr } = await supabase
        .from("knowledge_gaps")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("id", gapId);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await load();
    },
    [supabase, load],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Knowledge Coverage</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What the KB should answer, what it missed, and what needs a refresh. Phase 4
            of the KB-NEXT roadmap.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/knowledge/seed-targets"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted/40"
          >
            Seed targets →
          </Link>
          <Link
            href="/admin/knowledge/admin"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted/40"
          >
            KB Admin →
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {/* Overview KPI cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI
          label="Seed-target coverage"
          value={coverageKpiCoveragePctValue(rollup, kpiCtx)}
          sub={
            rollup ? `${rollup.covered_targets}/${rollup.total_targets} topics covered` : "loading…"
          }
          tone="default"
        />
        <KPI
          label="Open gaps"
          value={String(coverageKpiOpenGapsValue(rollup, kpiCtx))}
          sub={
            rollup
              ? `${rollup.resolved_last_30d} resolved in last 30d`
              : "loading…"
          }
          tone={rollup && rollup.open_gaps > 0 ? "warn" : "default"}
        />
        <KPI
          label="Stale + expired docs"
          value={String(coverageKpiStaleExpiredValue(rollup, kpiCtx))}
          sub={
            rollup
              ? `${rollup.expired_documents} expired · ${rollup.fresh_documents} fresh`
              : "loading…"
          }
          tone={rollup && rollup.expired_documents > 0 ? "danger" : "default"}
        />
        <KPI
          label="Review overdue"
          value={String(coverageKpiReviewOverdueValue(rollup, kpiCtx))}
          sub={rollup ? `of ${rollup.total_documents} total` : "loading…"}
          tone={rollup && rollup.review_overdue_count > 0 ? "warn" : "default"}
        />
      </section>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
        {(["overview", "gaps", "freshness"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              tab === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-md border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : (
        <>
          {tab === "overview" && rollup ? (
            <OverviewPanel rollup={rollup} />
          ) : null}
          {tab === "gaps" ? (
            <GapsPanel gaps={gaps} onResolve={resolveGap} />
          ) : null}
          {tab === "freshness" ? <FreshnessPanel rows={freshness} /> : null}
        </>
      )}
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "default" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-200 bg-rose-50/40"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50/40"
        : "border-border bg-card";
  return (
    <div className={`rounded-xl border ${toneClass} px-4 py-3`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function OverviewPanel({ rollup }: { rollup: DashboardRollup }) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Gaps by signal</h2>
        <ul className="mt-3 space-y-2 text-xs">
          <BreakdownRow label="No evidence (kb_empty)" value={rollup.open_gaps_kb_empty} />
          <BreakdownRow label="Thumbs down" value={rollup.open_gaps_thumbs_down} />
          <BreakdownRow label="Low confidence" value={rollup.open_gaps_low_confidence} />
          <BreakdownRow
            label="Router no-source"
            value={rollup.open_gaps_router_no_source}
          />
        </ul>
        <p className="mt-3 text-[10px] text-muted-foreground">
          Signals merge by normalized question; opening a gap from any surface
          (chat, Haven Insight, router) bumps frequency rather than duplicating.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Documents by freshness</h2>
        <ul className="mt-3 space-y-2 text-xs">
          <BreakdownRow label="Fresh (<90d)" value={rollup.fresh_documents} />
          <BreakdownRow label="Stale (90–180d)" value={rollup.stale_documents} tone="warn" />
          <BreakdownRow
            label="Expired (>180d)"
            value={rollup.expired_documents}
            tone="danger"
          />
          <BreakdownRow label="Unknown" value={rollup.unknown_freshness} />
        </ul>
        <p className="mt-3 text-[10px] text-muted-foreground">
          Refreshing a document (re-ingest or status flip) resets the clock.
          Re-approving moves it back to fresh.
        </p>
      </div>
    </section>
  );
}

function BreakdownRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "danger";
}) {
  const accent =
    tone === "danger"
      ? "text-rose-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-foreground";
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm font-semibold ${accent}`}>{value}</span>
    </li>
  );
}

function GapsPanel({
  gaps,
  onResolve,
}: {
  gaps: GapRow[];
  onResolve: (id: string) => Promise<void>;
}) {
  if (gaps.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No open gaps. The KB is currently answering everything it&apos;s been asked.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Question</th>
            <th className="px-3 py-2 text-left">Signal</th>
            <th className="px-3 py-2 text-left">Surface</th>
            <th className="px-3 py-2 text-right">Freq.</th>
            <th className="px-3 py-2 text-left">Last asked</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((g) => (
            <tr key={g.id} className="border-b border-border/60 last:border-b-0">
              <td className="px-3 py-2 text-foreground max-w-md truncate" title={g.question}>
                {g.question}
              </td>
              <td className="px-3 py-2 text-xs">
                <span className="inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {SIGNAL_LABELS[g.signal] ?? g.signal}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{g.surface}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{g.frequency}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {new Date(g.last_asked_at).toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => void onResolve(g.id)}
                  className="rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted/40"
                >
                  Resolve
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FreshnessPanel({ rows }: { rows: FreshnessRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No documents indexed yet for this organization.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Title</th>
            <th className="px-3 py-2 text-left">Compliance</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Age (days)</th>
            <th className="px-3 py-2 text-left">Review</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.document_id} className="border-b border-border/60 last:border-b-0">
              <td className="px-3 py-2 text-foreground max-w-md truncate" title={d.title}>
                <Link
                  href={`/admin/knowledge/documents/${d.document_id}`}
                  className="hover:underline"
                >
                  {d.title}
                </Link>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {formatCoverageComplianceCategory(d.compliance_category)}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] capitalize ${
                    FRESHNESS_TONE[d.freshness_status]
                  }`}
                >
                  {d.freshness_status}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs">
                {formatCoverageDaysSinceRefresh(d.days_since_refresh)}
              </td>
              <td className="px-3 py-2 text-xs">
                {d.review_overdue ? (
                  <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-800">
                    {formatCoverageReviewStatus(true)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {formatCoverageReviewStatus(false)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
