"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataFetchWrapper, type DataFetchState } from "@/components/ui/data-fetch-wrapper";
import { FilterPill } from "@/components/ui/filter-pill";
import { MetricCard } from "@/components/ui/metric-card";
import { SortableTableHeader } from "@/components/ui/sortable-table-header";
import { StatusPill, type StatusPillTone } from "@/components/ui/status-pill";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type PlanRuleRow = {
  id: string;
  interval_minutes: number | null;
  daypart_start: string | null;
  daypart_end: string | null;
  grace_minutes: number | null;
  sort_order: number | null;
  deleted_at?: string | null;
};

type PlanRow = {
  id: string;
  status: string;
  source_type: string;
  effective_from: string;
  effective_to: string | null;
  updated_at: string | null;
  rationale: string | null;
  residents?: {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    room_number?: string | null;
  } | null;
  resident_observation_plan_rules?: PlanRuleRow[];
};

type PlanFilter = "all" | "active" | "draft" | "suspended" | "expired";
type LoadState = "idle" | "loading" | "ready" | "error";
type SortColumn = "resident" | "effectiveFrom" | "updated";
type SortDirection = "asc" | "desc";

function displayName(person?: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
} | null) {
  return [person?.preferred_name ?? person?.first_name ?? null, person?.last_name ?? null]
    .filter(Boolean)
    .join(" ");
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value?: string | null) {
  if (!value) return "All day";
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(2026, 0, 1, hours, minutes),
  );
}

function getRules(plan: PlanRow) {
  return (plan.resident_observation_plan_rules ?? [])
    .filter((rule) => !rule.deleted_at)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function ruleSummary(plan: PlanRow) {
  const rules = getRules(plan);
  const firstRule = rules[0];
  if (!firstRule) return "No active rules";

  const interval = firstRule.interval_minutes ? `Q${firstRule.interval_minutes}min` : "Custom cadence";
  const window = `${formatTime(firstRule.daypart_start)}–${formatTime(firstRule.daypart_end)}`;
  const grace = `${firstRule.grace_minutes ?? 0}min grace`;
  const extra = rules.length > 1 ? ` + ${rules.length - 1} more` : "";
  return `${interval}, ${window}, ${grace}${extra}`;
}

function planFilterStatus(plan: PlanRow, nowMs = Date.now()): Exclude<PlanFilter, "all"> {
  const effectiveToMs = plan.effective_to ? new Date(plan.effective_to).getTime() : Number.NaN;
  if (plan.status === "ended" || plan.status === "cancelled" || (Number.isFinite(effectiveToMs) && effectiveToMs <= nowMs)) {
    return "expired";
  }
  if (plan.status === "paused") return "suspended";
  if (plan.status === "draft") return "draft";
  return "active";
}

function statusLabel(status: Exclude<PlanFilter, "all">) {
  if (status === "suspended") return "Suspended";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusTone(status: Exclude<PlanFilter, "all">): StatusPillTone {
  if (status === "expired") return "danger";
  if (status === "suspended" || status === "draft") return "warning";
  return "muted";
}

function deriveFetchState(args: {
  loadState: LoadState;
  totalPlans: number;
  visiblePlans: number;
  filterApplied: boolean;
}): DataFetchState {
  if (args.loadState === "idle" || args.loadState === "loading") return "loading";
  if (args.loadState === "error") return "error";
  if (args.totalPlans === 0 || (args.filterApplied && args.visiblePlans === 0)) return "success-empty";
  return "success-populated";
}

export default function AdminRoundingPlansPage() {
  const searchParams = useSearchParams();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const selectedFacility = availableFacilities.find((facility) => facility.id === selectedFacilityId);
  const facilityName = selectedFacility?.name ?? "selected facility";
  const supabase = useMemo(() => createClient(), []);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [filter, setFilter] = useState<PlanFilter>("all");

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
          "id, status, source_type, effective_from, effective_to, updated_at, rationale, residents ( first_name, last_name, preferred_name, room_number ), resident_observation_plan_rules ( id, interval_minutes, daypart_start, daypart_end, grace_minutes, sort_order, deleted_at )",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });

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
        throw new Error("Could not generate rounding tasks");
      }
      setGenerateMessage("Tasks generated for the next 8 hours.");
      await load();
    } catch {
      setGenerateMessage("Could not generate rounding tasks. Confirm facility scope and retry.");
    } finally {
      setGenerating(false);
    }
  }

  const nowMs = Date.now();
  const counts = useMemo(() => {
    const next = { all: plans.length, active: 0, draft: 0, suspended: 0, expired: 0 };
    for (const plan of plans) {
      next[planFilterStatus(plan, nowMs)] += 1;
    }
    return next;
  }, [plans, nowMs]);

  const totalRules = plans.reduce((sum, plan) => sum + getRules(plan).length, 0);
  const sortColumn = (searchParams.get("sort") as SortColumn | null) ?? "updated";
  const sortDirection = (searchParams.get("dir") as SortDirection | null) ?? "desc";

  const visiblePlans = useMemo(() => {
    const filtered = filter === "all" ? plans : plans.filter((plan) => planFilterStatus(plan, nowMs) === filter);
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortColumn === "resident") {
        return displayName(a.residents).localeCompare(displayName(b.residents)) * direction;
      }
      if (sortColumn === "effectiveFrom") {
        return (new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime()) * direction;
      }
      return (new Date(a.updated_at ?? a.effective_from).getTime() - new Date(b.updated_at ?? b.effective_from).getTime()) * direction;
    });
  }, [filter, nowMs, plans, sortColumn, sortDirection]);

  const fetchState = deriveFetchState({
    loadState,
    totalPlans: plans.length,
    visiblePlans: visiblePlans.length,
    filterApplied: filter !== "all",
  });

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Observation plans"
        subtitle={`Resident cadence rules, active observation windows, and shift-ready task generation at ${facilityName}.`}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={() => void generateTasks()}
              disabled={!selectedFacilityId || generating}
            >
              {generating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
              Generate next 8 hours
            </Button>
            <Link href="/admin/rounding/plans/new" className={cn(buttonVariants({ variant: "default", size: "default" }))}>
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
              <RefreshCw className={cn("size-4", loadState === "loading" && "animate-spin")} aria-hidden />
            </Button>
          </>
        }
      />

      <RoundingHubNav />

      {!selectedFacilityId ? (
        <AllFacilitiesInterstitial />
      ) : (
        <>
          {generateMessage ? <InfoBanner message={generateMessage} onDismiss={() => setGenerateMessage(null)} /> : null}

          <section aria-label="Observation plan summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Active plans" value={counts.active} thresholds={{ type: "informational" }} hint={`${plans.length} total · ${counts.draft} draft`} />
              <MetricCard label="Total rules" value={totalRules} thresholds={{ type: "informational" }} hint="Cadence rules across plans" />
              <MetricCard label="Suspended plans" value={counts.suspended} numericValue={counts.suspended} thresholds={{ type: "overdue-count" }} hint="Paused or held from task generation" />
              <MetricCard label="Expired plans" value={counts.expired} numericValue={counts.expired} thresholds={{ type: "critical-count" }} hint="Ended or past effective window" />
            </div>
          </section>

          <section aria-label="Filter observation plans">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <span className="shrink-0 text-[12px] font-medium text-muted-foreground">Filter</span>
              <div className="-mx-1 flex flex-1 items-center gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible md:pb-0">
                <FilterPill label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
                <FilterPill label="Active" count={counts.active} active={filter === "active"} onClick={() => setFilter(filter === "active" ? "all" : "active")} />
                <FilterPill label="Draft" count={counts.draft} tone="warning" active={filter === "draft"} onClick={() => setFilter(filter === "draft" ? "all" : "draft")} />
                <FilterPill label="Suspended" count={counts.suspended} tone="warning" active={filter === "suspended"} onClick={() => setFilter(filter === "suspended" ? "all" : "suspended")} />
                <FilterPill label="Expired" count={counts.expired} tone="danger" active={filter === "expired"} onClick={() => setFilter(filter === "expired" ? "all" : "expired")} />
                {filter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3" aria-hidden />
                    Clear filter
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <DataFetchWrapper
            state={fetchState}
            loading={<LoadingState />}
            error={<LoadErrorNotice message={errorMessage ?? "Could not load observation plans."} onRetry={() => void load()} />}
            empty={
              filter === "all" ? (
                <NoPlansEmptyState facilityName={facilityName} />
              ) : (
                <FilterEmptyState facilityName={facilityName} onClear={() => setFilter("all")} />
              )
            }
          >
            <PlansTable plans={visiblePlans} />
          </DataFetchWrapper>
        </>
      )}
    </div>
  );
}

function PlansTable({ plans }: { plans: PlanRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full min-w-[920px] text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <SortableTableHeader column="resident" defaultDirection="asc">Resident</SortableTableHeader>
            <th scope="col" className="px-3 py-2 text-left text-[12px] font-semibold text-muted-foreground">Rule summary</th>
            <SortableTableHeader column="effectiveFrom">Effective window</SortableTableHeader>
            <th scope="col" className="px-3 py-2 text-left text-[12px] font-semibold text-muted-foreground">Status</th>
            <SortableTableHeader column="updated">Last updated</SortableTableHeader>
            <th scope="col" className="px-3 py-2 text-right text-[12px] font-semibold text-muted-foreground">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {plans.map((plan) => {
            const resident = displayName(plan.residents) || "Resident";
            const room = plan.residents?.room_number;
            const derivedStatus = planFilterStatus(plan);
            return (
              <tr key={plan.id} className="bg-card transition-colors hover:bg-muted/30">
                <td className="px-3 py-3 align-top">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium text-foreground">{resident}</span>
                    {room ? <span className="text-[12px] text-muted-foreground">Room {room}</span> : null}
                  </div>
                </td>
                <td className="px-3 py-3 align-top text-[13px] text-muted-foreground">{ruleSummary(plan)}</td>
                <td className="px-3 py-3 align-top text-[13px] text-muted-foreground">
                  <div className="flex flex-col gap-1 tabular-nums">
                    <span>{formatDate(plan.effective_from)}</span>
                    <span>{plan.effective_to ? `Ends ${formatDate(plan.effective_to)}` : "Open-ended"}</span>
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <StatusPill value={statusLabel(derivedStatus)} defaultValue="Active" tone={statusTone(derivedStatus)} />
                </td>
                <td className="px-3 py-3 align-top text-[13px] tabular-nums text-muted-foreground">{formatDateTime(plan.updated_at ?? plan.effective_from)}</td>
                <td className="px-3 py-3 align-top">
                  <div className="flex justify-end gap-2">
                    <Link href={`/admin/rounding/plans/${plan.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8")}>View plan</Link>
                    <Link href={`/admin/rounding/plans/${plan.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8")}>Edit plan</Link>
                    <Link href={`/admin/rounding/plans/new?duplicatePlanId=${plan.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8")}>Duplicate plan</Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InfoBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-[13px] text-foreground">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center rounded-lg border border-border bg-card py-16 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
      Loading observation plans…
    </div>
  );
}

function AllFacilitiesInterstitial() {
  return (
    <section aria-label="Facility scope required" className="rounded-lg border border-dashed border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">Observation plans operate per facility</p>
          <p className="text-[13px] text-muted-foreground">Plans are facility-scoped. Select a facility from the top bar to continue.</p>
        </div>
      </div>
    </section>
  );
}

function LoadErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <p className="text-[13px] leading-relaxed text-foreground">{message}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} className="h-8 shrink-0 text-[12px]">
        Retry
      </Button>
    </div>
  );
}

function NoPlansEmptyState({ facilityName }: { facilityName: string }) {
  return (
    <section aria-label="No observation plans" className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
      <ClipboardList className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">No observation plans at {facilityName}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">Create one to define rounding cadence.</p>
      <div className="mt-4">
        <Link href="/admin/rounding/plans/new" className={cn(buttonVariants({ variant: "default", size: "sm" }))}>
          <Plus className="size-4" aria-hidden />
          New plan
        </Link>
      </div>
    </section>
  );
}

function FilterEmptyState({ facilityName, onClear }: { facilityName: string; onClear: () => void }) {
  return (
    <section aria-label="No plans match filter" className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
      <ClipboardList className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">No plans match this filter at {facilityName}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">Adjust the filter to see other observation plans.</p>
      <div className="mt-4">
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          <X className="size-4" aria-hidden />
          Clear filter
        </Button>
      </div>
    </section>
  );
}
