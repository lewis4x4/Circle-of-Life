"use client";

/**
 * AI Safety Insights Dashboard
 * Shows Claude-generated clinical patterns and early warnings per resident.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertTriangle,
  BarChart3,
  Brain,
  Building2,
  CheckCircle,
  Eye,
  Loader2,
  Mic,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  X,
  XCircle,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type Severity = "critical" | "high" | "medium" | "low";
type Status = "new" | "acknowledged" | "acted_on" | "dismissed";

interface InsightRow {
  id: string;
  resident_id: string;
  facility_id: string;
  insight_type: string;
  severity: Severity;
  title: string;
  body: string | null;
  clinical_domains: string[];
  status: Status;
  ai_model: string | null;
  created_at: string;
  residents?: { first_name: string; last_name: string } | null;
  facilities?: { name: string } | null;
}

type LoadState = "idle" | "loading" | "ready" | "error";

type BoardState =
  | "no_facility"
  | "loading"
  | "error"
  | "empty"
  | "empty_filtered"
  | "populated";

type Tone = "default" | "warning" | "danger";

type StatusFilter = "all" | "new" | "acknowledged";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const TYPE_ICONS: Record<string, typeof Brain> = {
  pattern_detected: Eye,
  risk_escalation: AlertTriangle,
  intervention_needed: AlertTriangle,
  decline_observed: TrendingDown,
  positive_trend: TrendingUp,
};

function severityTone(severity: Severity): Tone {
  if (severity === "critical") return "danger";
  if (severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "default";
}

function severityChipClasses(severity: Severity): string {
  const tone = severityTone(severity);
  if (tone === "danger") return "border-danger/30 bg-danger/10 text-danger";
  if (tone === "warning") return "border-warning/30 bg-warning/10 text-warning";
  return "border-border bg-muted text-muted-foreground";
}

function resolveCriticalTone(count: number): Tone {
  return count > 0 ? "danger" : "default";
}

function resolveNewTone(count: number): Tone {
  if (count === 0) return "default";
  if (count <= 3) return "warning";
  return "danger";
}

function deriveBoardState(args: {
  loadState: LoadState;
  hasFacility: boolean;
  rowCount: number;
  filterApplied: boolean;
}): BoardState {
  if (!args.hasFacility) return "no_facility";
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  if (args.rowCount === 0) {
    return args.filterApplied ? "empty_filtered" : "empty";
  }
  return "populated";
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function InsightsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setRows([]);
      setLoadState("ready");
      return;
    }

    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);

      let query = supabase
        .from("resident_safety_insights")
        .select("*, residents(first_name, last_name), facilities(name)")
        .eq("organization_id", ctx.ctx.organizationId)
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter !== "all") query = query.eq("status", filter);

      const { data, error } = await query;
      if (error) throw error;
      setRows((data ?? []) as InsightRow[]);
      setLoadState("ready");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not load AI safety insights.",
      );
      setRows([]);
      setLoadState("error");
    }
  }, [supabase, filter, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAnalysis() {
    setRunning(true);
    setRunMessage(null);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/admin/rounding/insights/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxResidents: 25 }),
      });
      const json = (await response.json()) as {
        error?: string;
        residentsAnalyzed?: number;
        insightsGenerated?: number;
        alertsCreated?: number;
      };
      if (!response.ok) throw new Error(json.error ?? "Could not run analysis");
      setRunMessage(
        `Analyzed ${json.residentsAnalyzed ?? 0} residents · ${json.insightsGenerated ?? 0} insight${json.insightsGenerated === 1 ? "" : "s"} generated · ${json.alertsCreated ?? 0} alert${json.alertsCreated === 1 ? "" : "s"} created.`,
      );
      await load();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not run resident assurance AI.",
      );
    } finally {
      setRunning(false);
    }
  }

  const updateStatus = useCallback(
    async (id: string, status: Status) => {
      const { error } = await supabase
        .from("resident_safety_insights")
        .update({
          status,
          ...(status === "acknowledged" ? { acknowledged_at: new Date().toISOString() } : {}),
          ...(status === "acted_on" ? { acted_on_at: new Date().toISOString() } : {}),
        })
        .eq("id", id);
      if (!error) void load();
    },
    [supabase, load],
  );

  /* ------------------------------- Derived ------------------------------- */

  const counts = useMemo(() => {
    let critical = 0;
    let newCount = 0;
    for (const row of rows) {
      if (row.severity === "critical") critical += 1;
      if (row.status === "new") newCount += 1;
    }
    return { critical, newCount };
  }, [rows]);

  const boardState = deriveBoardState({
    loadState,
    hasFacility: Boolean(selectedFacilityId),
    rowCount: rows.length,
    filterApplied: filter !== "all",
  });

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="AI safety insights"
        subtitle="Claude-powered clinical pattern detection and early warnings for residents in scope."
        actions={
          <>
            <Button
              type="button"
              variant="default"
              size="default"
              onClick={() => void runAnalysis()}
              disabled={!selectedFacilityId || running}
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <BarChart3 className="size-4" aria-hidden />
              )}
              {running ? "Running analysis" : "Run analysis"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void load()}
              aria-label="Refresh insights"
              title="Refresh"
              disabled={loadState === "loading"}
            >
              <RefreshCw
                className={cn("size-4", loadState === "loading" && "animate-spin")}
                aria-hidden
              />
            </Button>
          </>
        }
      />

      <RoundingHubNav />

      {boardState === "no_facility" ? (
        <AllFacilitiesInterstitial />
      ) : boardState === "error" ? (
        <LoadErrorNotice
          message={errorMessage ?? "Could not load AI safety insights."}
          onRetry={() => void load()}
        />
      ) : (
        <>
          {runMessage ? (
            <InfoBanner message={runMessage} onDismiss={() => setRunMessage(null)} />
          ) : null}

          {/* KPI strip */}
          <section aria-label="Insight summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <KpiCard
                label="Insight backlog"
                value={rows.length}
                tone="default"
                hint="Resident safety insights in scope"
              />
              <KpiCard
                label="New patterns"
                value={counts.newCount}
                tone={resolveNewTone(counts.newCount)}
                hint="Unacknowledged findings from the latest runs"
              />
              <KpiCard
                label="Critical severity"
                value={counts.critical}
                tone={resolveCriticalTone(counts.critical)}
                hint="Findings flagged at the highest severity"
              />
            </div>
          </section>

          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Mic className="size-3.5" aria-hidden />
              Voice check-off feeds this safety model. Run a manual analysis after a shift surge
              or incident cluster.
            </span>
          </div>

          {/* Filter pills */}
          <section aria-label="Filter insights">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
                Status
              </span>
              <div className="-mx-1 flex flex-1 items-center gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible md:pb-0">
                <FilterPill
                  label="All"
                  count={rows.length}
                  tone="default"
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                />
                <FilterPill
                  label="New"
                  count={counts.newCount}
                  tone={resolveNewTone(counts.newCount)}
                  active={filter === "new"}
                  onClick={() => setFilter(filter === "new" ? "all" : "new")}
                />
                <FilterPill
                  label="Acknowledged"
                  count={rows.filter((r) => r.status === "acknowledged").length}
                  tone="default"
                  active={filter === "acknowledged"}
                  onClick={() => setFilter(filter === "acknowledged" ? "all" : "acknowledged")}
                />
                {filter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3" aria-hidden />
                    Clear filter
                  </button>
                )}
              </div>
            </div>
          </section>

          {boardState === "empty" ? (
            <NoInsightsEmptyState />
          ) : boardState === "empty_filtered" ? (
            <FilterEmptyState onClear={() => setFilter("all")} />
          ) : (
            <ul className="flex flex-col gap-2" aria-label="AI safety insights">
              {rows.map((row) => {
                const Icon = TYPE_ICONS[row.insight_type] ?? Eye;
                const name = row.residents
                  ? `${row.residents.first_name} ${row.residents.last_name}`
                  : row.resident_id.slice(0, 8);

                return (
                  <li key={row.id}>
                    <article className="rounded-lg border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div
                            className={cn(
                              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
                              severityChipClasses(row.severity),
                            )}
                            aria-hidden
                          >
                            <Icon className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-foreground">
                              {row.title}
                            </p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">
                              {name}
                              {row.facilities?.name ? ` · ${row.facilities.name}` : ""}
                              <span aria-hidden className="px-1.5 text-border">
                                ·
                              </span>
                              {new Date(row.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
                              severityChipClasses(row.severity),
                            )}
                          >
                            {row.severity}
                          </span>
                          <span className="hidden text-[11px] text-muted-foreground sm:inline">
                            {row.insight_type.replace(/_/g, " ")}
                          </span>
                        </div>
                      </div>

                      {row.body ? (
                        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                          {row.body}
                        </p>
                      ) : null}

                      {row.clinical_domains.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {row.clinical_domains.map((domain) => (
                            <span
                              key={domain}
                              className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {domain.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {row.status === "new" && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void updateStatus(row.id, "acknowledged")}
                          >
                            <CheckCircle className="size-3.5" aria-hidden />
                            Acknowledge
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void updateStatus(row.id, "acted_on")}
                          >
                            <CheckCircle className="size-3.5" aria-hidden />
                            Mark acted on
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void updateStatus(row.id, "dismissed")}
                          >
                            <XCircle className="size-3.5" aria-hidden />
                            Dismiss
                          </Button>
                          {row.ai_model ? (
                            <span className="ml-auto text-[11px] text-muted-foreground">
                              Model: {row.ai_model}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  KPI card                                                                  */
/* -------------------------------------------------------------------------- */

function KpiCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: Tone;
  hint: string;
}) {
  return (
    <article
      aria-label={`${label}: ${value}`}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-md border bg-card px-4 py-3",
        tone === "danger" && "border-danger/40",
        tone === "warning" && "border-warning/40",
        tone === "default" && "border-border",
      )}
    >
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums tracking-tight",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*  Filter pill                                                                */
/* -------------------------------------------------------------------------- */

function FilterPill({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: Tone;
  active: boolean;
  onClick: () => void;
}) {
  const showSemanticTint = tone !== "default" && count > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && tone === "danger" && "border-danger bg-danger/10 text-danger",
        active && tone === "warning" && "border-warning bg-warning/10 text-warning",
        active && tone === "default" && "border-border-strong bg-muted text-foreground",
        !active &&
          showSemanticTint &&
          tone === "danger" &&
          "border-danger/30 bg-card text-danger hover:bg-danger/5",
        !active &&
          showSemanticTint &&
          tone === "warning" &&
          "border-warning/30 bg-card text-warning hover:bg-warning/5",
        !active &&
          !showSemanticTint &&
          "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span className={cn("tabular-nums opacity-80", active && "opacity-100")}>({count})</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Notices + empty states                                                    */
/* -------------------------------------------------------------------------- */

function InfoBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-[13px] text-foreground"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function AllFacilitiesInterstitial() {
  return (
    <section
      aria-label="Facility scope required"
      className="rounded-lg border border-dashed border-border bg-card p-6"
    >
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            Insights operate per facility
          </p>
          <p className="text-[13px] text-muted-foreground">
            AI safety insights are facility-scoped. Select a facility from the top bar to
            continue.
          </p>
        </div>
      </div>
    </section>
  );
}

function LoadErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden
        />
        <p className="text-[13px] leading-relaxed text-foreground">{message}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="h-8 shrink-0 text-[12px]"
      >
        Retry
      </Button>
    </div>
  );
}

function NoInsightsEmptyState() {
  return (
    <section
      aria-label="No AI insights"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <Brain className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">No AI insights yet</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        The assurance AI runs daily to analyze clinical patterns. Run a manual analysis to
        surface findings now.
      </p>
    </section>
  );
}

function FilterEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <section
      aria-label="No insights match filter"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <Brain className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">
        No insights match the current filter
      </p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Adjust the filter to see other insights in this facility.
      </p>
      <div className="mt-4">
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          <X className="size-4" aria-hidden />
          Clear filter
        </Button>
      </div>
    </section>
  );
}
