"use client";

import { formatDisplayDateTime } from "@/lib/format/datetime";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { StatusPill } from "@/components/ui/status-pill";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { loadReportRunHistory, type ReportRunHistoryItem } from "@/lib/reports/load-report-run-history";
import { formatReportRunCompletedAt } from "@/lib/reports/reports-display-copy";
import { createClient } from "@/lib/supabase/client";

export default function ReportHistoryPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<ReportRunHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);
        const items = await loadReportRunHistory(supabase, ctx.ctx.organizationId, 100);
        if (alive) setRows(items);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load report history.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  return (
    <div className="w-full space-y-6">
      <ReportsHubNav />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Run history</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Who ran which report, for which facility, when it finished, and how it ended.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="recent-runs-heading" className="rounded-lg border border-border bg-card">
        <h2 id="recent-runs-heading" className="border-b border-border px-4 py-3 text-[15px] font-semibold text-foreground">
          Recent report runs
        </h2>
        {loading ? (
          <p className="px-4 py-10 text-sm text-muted-foreground">Loading runs…</p>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No report runs yet</p>
            <p className="mt-1">Runs appear here after a report is run by hand or by a schedule.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto_auto] md:items-center md:gap-6">
                <div className="min-w-0 space-y-0.5">
                  <Link
                    href={`/admin/reports/history/${row.id}`}
                    className="block truncate font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {row.reportName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.facilityLabel} · {row.runKindLabel}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Run by</p>
                  <p className="truncate text-foreground">{row.runByLabel}</p>
                </div>
                <div>
                  <StatusPill tone={row.state.tone}>{row.state.label}</StatusPill>
                </div>
                <div className="tabular-nums">
                  <p className="text-xs text-muted-foreground">Started</p>
                  <p className="text-foreground">{formatDisplayDateTime(row.startedAt)}</p>
                </div>
                <div className="tabular-nums">
                  <p className="text-xs text-muted-foreground">Finished</p>
                  <p className="text-muted-foreground">
                    {row.state.kind === "interrupted" ? "Did not finish" : formatReportRunCompletedAt(row.completedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
