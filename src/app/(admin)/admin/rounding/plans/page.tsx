"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  ClipboardList,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type PlanRow = {
  id: string;
  status: string;
  source_type: string;
  effective_from: string;
  rationale: string | null;
  residents?: {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    room_number?: string | null;
  } | null;
  resident_observation_plan_rules?: { id: string }[];
};

type SourceFilter =
  | "all"
  | "active"
  | "paused"
  | "manual"
  | "clinical_order"
  | "admission_default"
  | "family_request"
  | "survey_visit";

type LoadState = "idle" | "loading" | "ready" | "error";

type BoardState = "no_facility" | "loading" | "error" | "empty" | "empty_filtered" | "populated";

type Tone = "default" | "warning" | "danger";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function displayName(person?: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
} | null) {
  return [person?.preferred_name ?? person?.first_name ?? null, person?.last_name ?? null]
    .filter(Boolean)
    .join(" ");
}

const SOURCE_LABEL: Record<string, string> = {
  clinical_order: "Clinical order",
  admission_default: "Admission default",
  family_request: "Family request",
  survey_visit: "Survey visit",
  manual: "Manual",
};

function deriveBoardState(args: {
  loadState: LoadState;
  hasFacility: boolean;
  totalPlans: number;
  filteredPlans: number;
  filterApplied: boolean;
}): BoardState {
  if (!args.hasFacility) return "no_facility";
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  if (args.totalPlans === 0) return "empty";
  if (args.filterApplied && args.filteredPlans === 0) return "empty_filtered";
  return "populated";
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function AdminRoundingPlansPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [filter, setFilter] = useState<SourceFilter>("all");

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setPlans([]);
      setLoadState("ready");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("resident_observation_plans")
        .select(
          "id, status, source_type, effective_from, rationale, residents ( first_name, last_name, preferred_name, room_number ), resident_observation_plan_rules ( id )",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("effective_from", { ascending: false });

      if (error) throw error;
      setPlans((data ?? []) as unknown as PlanRow[]);
      setLoadState("ready");
    } catch {
      setErrorMessage("Could not load observation plans. Confirm facility scope and retry.");
      setPlans([]);
      setLoadState("error");
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generateTasks() {
    if (!selectedFacilityId) return;
    setGenerating(true);
    setGenerateMessage(null);
    try {
      const now = new Date();
      const response = await fetch("/api/rounding/generate-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId: selectedFacilityId,
          windowStart: now.toISOString(),
          windowEnd: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
        }),
      });
      if (!response.ok) {
        const json = (await response.json()) as { error?: string };
        throw new Error(json.error ?? "Could not generate rounding tasks");
      }
      setGenerateMessage("Tasks generated for the next 8 hours.");
      await load();
    } catch (error) {
      setGenerateMessage(
        error instanceof Error ? error.message : "Could not generate rounding tasks.",
      );
    } finally {
      setGenerating(false);
    }
  }

  /* ------------------------------- Derived ------------------------------- */

  const activeCount = plans.filter((p) => p.status === "active").length;
  const pausedCount = plans.filter((p) => p.status === "paused").length;
  const clinicalCount = plans.filter((p) => p.source_type === "clinical_order").length;
  const admissionCount = plans.filter((p) => p.source_type === "admission_default").length;
  const familyCount = plans.filter((p) => p.source_type === "family_request").length;
  const manualCount = plans.filter((p) => p.source_type === "manual").length;
  const surveyCount = plans.filter((p) => p.source_type === "survey_visit").length;
  const totalRules = plans.reduce(
    (sum, p) => sum + (p.resident_observation_plan_rules?.length ?? 0),
    0,
  );

  const filteredPlans = useMemo(() => {
    if (filter === "all") return plans;
    if (filter === "active") return plans.filter((p) => p.status === "active");
    if (filter === "paused") return plans.filter((p) => p.status === "paused");
    return plans.filter((p) => p.source_type === filter);
  }, [plans, filter]);

  const boardState = deriveBoardState({
    loadState,
    hasFacility: Boolean(selectedFacilityId),
    totalPlans: plans.length,
    filteredPlans: filteredPlans.length,
    filterApplied: filter !== "all",
  });

  /* ------------------------------- Render ------------------------------- */

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Observation plans"
        subtitle="Resident cadence rules, active observation windows, and shift-ready task generation."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={() => void generateTasks()}
              disabled={!selectedFacilityId || generating}
            >
              {generating ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              Generate next 8 hours
            </Button>
            <Link
              href="/admin/rounding/plans/new"
              className={cn(buttonVariants({ variant: "default", size: "default" }))}
            >
              <Plus className="size-4" aria-hidden />
              New plan
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void load()}
              aria-label="Refresh observation plans"
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
          message={errorMessage ?? "Could not load observation plans."}
          onRetry={() => void load()}
        />
      ) : (
        <>
          {generateMessage ? (
            <InfoBanner message={generateMessage} onDismiss={() => setGenerateMessage(null)} />
          ) : null}

          {/* KPI strip — informational; value-derived tone where helpful */}
          <section aria-label="Observation plan summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Active plans"
                value={activeCount}
                tone="default"
                hint={`${plans.length} total · ${pausedCount} paused`}
              />
              <KpiCard
                label="Total rules"
                value={totalRules}
                tone="default"
                hint="Cadence rules across active plans"
              />
              <KpiCard
                label="Clinical orders"
                value={clinicalCount}
                tone="default"
                hint="Plans sourced from clinical orders"
              />
              <KpiCard
                label="Other sources"
                value={admissionCount + familyCount + manualCount + surveyCount}
                tone="default"
                hint="Admission, family, manual, or survey sources"
              />
            </div>
          </section>

          {/* Filter pills */}
          <section aria-label="Filter observation plans">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
                Filter
              </span>
              <div className="-mx-1 flex flex-1 items-center gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible md:pb-0">
                <FilterPill
                  label="All"
                  count={plans.length}
                  tone="default"
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                />
                <FilterPill
                  label="Active"
                  count={activeCount}
                  tone="default"
                  active={filter === "active"}
                  onClick={() => setFilter(filter === "active" ? "all" : "active")}
                />
                <FilterPill
                  label="Paused"
                  count={pausedCount}
                  tone="default"
                  active={filter === "paused"}
                  onClick={() => setFilter(filter === "paused" ? "all" : "paused")}
                />
                <FilterPill
                  label="Clinical orders"
                  count={clinicalCount}
                  tone="default"
                  active={filter === "clinical_order"}
                  onClick={() =>
                    setFilter(filter === "clinical_order" ? "all" : "clinical_order")
                  }
                />
                <FilterPill
                  label="Admission default"
                  count={admissionCount}
                  tone="default"
                  active={filter === "admission_default"}
                  onClick={() =>
                    setFilter(filter === "admission_default" ? "all" : "admission_default")
                  }
                />
                <FilterPill
                  label="Family request"
                  count={familyCount}
                  tone="default"
                  active={filter === "family_request"}
                  onClick={() =>
                    setFilter(filter === "family_request" ? "all" : "family_request")
                  }
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
            <NoPlansEmptyState />
          ) : boardState === "empty_filtered" ? (
            <FilterEmptyState onClear={() => setFilter("all")} />
          ) : (
            <ul
              className="grid grid-cols-1 gap-3 md:grid-cols-2"
              aria-label="Observation plans"
            >
              {filteredPlans.map((plan) => {
                const room = (
                  plan.residents as PlanRow["residents"] & {
                    room_number?: string | null;
                  }
                )?.room_number;
                const ruleCount = plan.resident_observation_plan_rules?.length ?? 0;

                return (
                  <li key={plan.id}>
                    <Link
                      href={`/admin/rounding/plans/${plan.id}`}
                      className={cn(
                        "group block h-full rounded-lg border bg-card p-4 transition-colors hover:border-border-strong hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        plan.status === "active" ? "border-border" : "border-border opacity-80",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <ClipboardList
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="truncate text-sm font-semibold text-foreground">
                            {displayName(plan.residents) || "Resident"}
                          </span>
                          {room ? (
                            <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                              Room {room}
                            </span>
                          ) : null}
                        </div>
                        <Badge
                          variant={plan.status === "active" ? "default" : "outline"}
                          className="text-[11px] capitalize"
                        >
                          {plan.status}
                        </Badge>
                      </div>

                      {plan.rationale ? (
                        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                          {plan.rationale}
                        </p>
                      ) : null}

                      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Settings2 className="size-3" aria-hidden />
                          <span>
                            {SOURCE_LABEL[plan.source_type] ??
                              plan.source_type.replace(/_/g, " ")}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="size-3" aria-hidden />
                          <span className="tabular-nums">
                            {new Date(plan.effective_from).toLocaleDateString()}
                          </span>
                        </div>
                        <span className="tabular-nums">
                          {ruleCount} rule{ruleCount === 1 ? "" : "s"}
                        </span>
                      </dl>
                    </Link>
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
      className="flex items-center justify-between gap-3 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-[13px] text-foreground"
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
            Observation plans operate per facility
          </p>
          <p className="text-[13px] text-muted-foreground">
            Plans are facility-scoped. Select a facility from the top bar to continue.
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

function NoPlansEmptyState() {
  return (
    <section
      aria-label="No observation plans"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <ClipboardList className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">No observation plans yet</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Create a plan to define rounding cadence and resident-specific observation rules.
      </p>
      <div className="mt-4">
        <Link
          href="/admin/rounding/plans/new"
          className={cn(buttonVariants({ variant: "default", size: "sm" }))}
        >
          <Plus className="size-4" aria-hidden />
          Create plan
        </Link>
      </div>
    </section>
  );
}

function FilterEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <section
      aria-label="No plans match filter"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <ClipboardList className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">
        No plans match the current filter
      </p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Adjust the filter to see other plans in this facility.
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
