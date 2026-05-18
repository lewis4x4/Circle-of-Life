"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type FollowUpStatus = "open" | "in_progress" | "resolved" | "dismissed";

type EscalationRow = {
  id: string;
  resident_id: string;
  task_id: string;
  escalation_level: number;
  escalation_type: string;
  triggered_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  status: FollowUpStatus;
  residents?: {
    first_name: string;
    last_name: string;
    preferred_name: string | null;
  } | null;
  resident_observation_tasks?: {
    status: string;
    due_at: string;
    grace_ends_at: string;
    notes: string | null;
    watch_instance_id: string | null;
  } | null;
  watchSummary?: {
    protocolName: string | null;
    watchStatus: string;
    triggeredByType: string;
    incidentId: string | null;
    incidentNumber: string | null;
    incidentCategory: string | null;
  };
};

type LoadState = "idle" | "loading" | "ready" | "error";

type BoardState =
  | "no_facility"
  | "loading"
  | "error"
  | "empty"
  | "empty_filtered"
  | "populated";

type Tone = "default" | "warning" | "danger";

type StatusFilter = "all" | FollowUpStatus;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function residentName(row: EscalationRow["residents"], fallback: string) {
  if (!row) return fallback;
  return row.preferred_name?.trim() || `${row.first_name} ${row.last_name}`;
}

function relTime(ts: string) {
  const deltaMinutes = Math.round((new Date(ts).getTime() - Date.now()) / 60000);
  if (Math.abs(deltaMinutes) < 60)
    return `${Math.abs(deltaMinutes)} min ${deltaMinutes >= 0 ? "from now" : "ago"}`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 48)
    return `${Math.abs(deltaHours)} hr ${deltaHours >= 0 ? "from now" : "ago"}`;
  const deltaDays = Math.round(deltaHours / 24);
  return `${Math.abs(deltaDays)} day${Math.abs(deltaDays) === 1 ? "" : "s"} ${deltaDays >= 0 ? "from now" : "ago"}`;
}

function statusTone(status: FollowUpStatus): Tone {
  if (status === "open") return "danger";
  if (status === "in_progress") return "warning";
  return "default";
}

function statusLabel(status: FollowUpStatus): string {
  if (status === "in_progress") return "In progress";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusChipClasses(status: FollowUpStatus): string {
  const tone = statusTone(status);
  if (tone === "danger") return "border-danger/30 bg-danger/10 text-danger";
  if (tone === "warning") return "border-warning/30 bg-warning/10 text-warning";
  return "border-border bg-muted text-muted-foreground";
}

function resolveOpenTone(count: number): Tone {
  if (count === 0) return "default";
  if (count <= 2) return "warning";
  return "danger";
}

function resolveInProgressTone(count: number): Tone {
  return count > 0 ? "warning" : "default";
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
  if (args.rowCount === 0) return args.filterApplied ? "empty_filtered" : "empty";
  return "populated";
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function RoundingEscalationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<EscalationRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<StatusFilter>("all");

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setRows([]);
      setLoadState("ready");
      return;
    }

    try {
      let query = supabase
        .from("resident_observation_escalations")
        .select(
          `
          id,
          resident_id,
          task_id,
          escalation_level,
          escalation_type,
          triggered_at,
          acknowledged_at,
          resolved_at,
          resolution_note,
          status,
          residents(first_name, last_name, preferred_name),
          resident_observation_tasks(status, due_at, grace_ends_at, notes, watch_instance_id)
        `,
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("triggered_at", { ascending: false })
        .limit(100);

      if (filter !== "all") query = query.eq("status", filter);

      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      const escalationRows = (data ?? []) as unknown as EscalationRow[];

      const watchIds = Array.from(
        new Set(
          escalationRows
            .map((row) => row.resident_observation_tasks?.watch_instance_id)
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      );

      if (watchIds.length === 0) {
        setRows(escalationRows);
        setLoadState("ready");
        return;
      }

      const { data: watchRows, error: watchError } = await supabase
        .from("resident_watch_instances")
        .select(
          "id, status, triggered_by_type, triggered_by_id, resident_watch_protocols(name)",
        )
        .in("id", watchIds)
        .is("deleted_at", null);

      if (watchError) throw watchError;

      const watchMap = new Map(
        ((watchRows ?? []) as Array<{
          id: string;
          status: string;
          triggered_by_type: string;
          triggered_by_id: string | null;
          resident_watch_protocols?: { name: string } | null;
        }>).map((row) => [row.id, row]),
      );

      const incidentIds = Array.from(
        new Set(
          Array.from(watchMap.values())
            .filter((row) => row.triggered_by_type.startsWith("incident_") && row.triggered_by_id)
            .map((row) => row.triggered_by_id as string),
        ),
      );

      const incidentMap = new Map<string, { incident_number: string; category: string }>();
      if (incidentIds.length > 0) {
        const { data: incidents, error: incidentError } = await supabase
          .from("incidents")
          .select("id, incident_number, category")
          .in("id", incidentIds)
          .is("deleted_at", null);
        if (incidentError) throw incidentError;
        for (const incident of (incidents ?? []) as Array<{
          id: string;
          incident_number: string;
          category: string;
        }>) {
          incidentMap.set(incident.id, {
            incident_number: incident.incident_number,
            category: incident.category,
          });
        }
      }

      const enriched = escalationRows.map((row) => {
        const watchId = row.resident_observation_tasks?.watch_instance_id;
        if (!watchId) return row;
        const watch = watchMap.get(watchId);
        if (!watch) return row;
        const incident = watch.triggered_by_id
          ? incidentMap.get(watch.triggered_by_id)
          : undefined;
        return {
          ...row,
          watchSummary: {
            protocolName: watch.resident_watch_protocols?.name ?? null,
            watchStatus: watch.status,
            triggeredByType: watch.triggered_by_type,
            incidentId: watch.triggered_by_type.startsWith("incident_")
              ? watch.triggered_by_id
              : null,
            incidentNumber: incident?.incident_number ?? null,
            incidentCategory: incident?.category ?? null,
          },
        };
      });

      setRows(enriched);
      setLoadState("ready");
    } catch (loadError) {
      setErrorMessage(
        loadError instanceof Error ? loadError.message : "Could not load escalations.",
      );
      setRows([]);
      setLoadState("error");
    }
  }, [filter, selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      open: rows.filter((row) => row.status === "open").length,
      in_progress: rows.filter((row) => row.status === "in_progress").length,
      resolved: rows.filter((row) => row.status === "resolved").length,
      dismissed: rows.filter((row) => row.status === "dismissed").length,
    }),
    [rows],
  );

  const runAction = useCallback(
    async (id: string, action: "start_review" | "resolve" | "dismiss") => {
      setActionLoading(`${id}:${action}`);
      setErrorMessage(null);
      setActionMessage(null);

      try {
        const response = await fetch(`/api/rounding/escalations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            note: notes[id]?.trim() || undefined,
          }),
        });

        const json = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(json.error ?? "Could not update escalation");

        setActionMessage(
          action === "start_review"
            ? "Escalation moved into review."
            : action === "resolve"
              ? "Escalation resolved."
              : "Escalation dismissed.",
        );
        setNotes((current) => ({ ...current, [id]: "" }));
        await load();
      } catch (runError) {
        setErrorMessage(
          runError instanceof Error ? runError.message : "Could not update escalation.",
        );
      } finally {
        setActionLoading(null);
      }
    },
    [load, notes],
  );

  const boardState = deriveBoardState({
    loadState,
    hasFacility: Boolean(selectedFacilityId),
    rowCount: rows.length,
    filterApplied: filter !== "all",
  });

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Observation escalations"
        subtitle="Critically overdue and missed observation work — review, resolve, or dismiss with preserved task evidence."
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void load()}
            aria-label="Refresh escalations"
            title="Refresh"
            disabled={loadState === "loading"}
          >
            <RefreshCw
              className={cn("size-4", loadState === "loading" && "animate-spin")}
              aria-hidden
            />
          </Button>
        }
      />

      <RoundingHubNav />

      {boardState === "no_facility" ? (
        <AllFacilitiesInterstitial />
      ) : boardState === "error" ? (
        <LoadErrorNotice
          message={errorMessage ?? "Could not load escalations."}
          onRetry={() => void load()}
        />
      ) : (
        <>
          {actionMessage ? (
            <InfoBanner
              tone="success"
              message={actionMessage}
              onDismiss={() => setActionMessage(null)}
            />
          ) : null}

          {/* KPI strip */}
          <section aria-label="Escalation summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Open"
                value={counts.open}
                tone={resolveOpenTone(counts.open)}
                hint="Awaiting review"
              />
              <KpiCard
                label="In progress"
                value={counts.in_progress}
                tone={resolveInProgressTone(counts.in_progress)}
                hint="Under supervisor review"
              />
              <KpiCard
                label="Resolved"
                value={counts.resolved}
                tone="default"
                hint="Closed escalations"
              />
              <KpiCard
                label="Dismissed"
                value={counts.dismissed}
                tone="default"
                hint="Reviewed and dismissed"
              />
            </div>
          </section>

          {/* Filter pills */}
          <section aria-label="Filter escalations">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
                Filter
              </span>
              <div className="-mx-1 flex flex-1 items-center gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible md:pb-0">
                <FilterPill
                  label="All"
                  count={
                    counts.open + counts.in_progress + counts.resolved + counts.dismissed
                  }
                  tone="default"
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                />
                <FilterPill
                  label="Open"
                  count={counts.open}
                  tone={resolveOpenTone(counts.open)}
                  active={filter === "open"}
                  onClick={() => setFilter(filter === "open" ? "all" : "open")}
                />
                <FilterPill
                  label="In progress"
                  count={counts.in_progress}
                  tone={resolveInProgressTone(counts.in_progress)}
                  active={filter === "in_progress"}
                  onClick={() => setFilter(filter === "in_progress" ? "all" : "in_progress")}
                />
                <FilterPill
                  label="Resolved"
                  count={counts.resolved}
                  tone="default"
                  active={filter === "resolved"}
                  onClick={() => setFilter(filter === "resolved" ? "all" : "resolved")}
                />
                <FilterPill
                  label="Dismissed"
                  count={counts.dismissed}
                  tone="default"
                  active={filter === "dismissed"}
                  onClick={() => setFilter(filter === "dismissed" ? "all" : "dismissed")}
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
            <NoEscalationsEmptyState />
          ) : boardState === "empty_filtered" ? (
            <FilterEmptyState onClear={() => setFilter("all")} />
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Escalations">
              {rows.map((row) => (
                <li key={row.id}>
                  <EscalationCard
                    row={row}
                    note={notes[row.id] ?? ""}
                    onNoteChange={(value) =>
                      setNotes((current) => ({ ...current, [row.id]: value }))
                    }
                    actionLoading={actionLoading}
                    onAction={(action) => void runAction(row.id, action)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Escalation card                                                            */
/* -------------------------------------------------------------------------- */

function EscalationCard({
  row,
  note,
  onNoteChange,
  actionLoading,
  onAction,
}: {
  row: EscalationRow;
  note: string;
  onNoteChange: (value: string) => void;
  actionLoading: string | null;
  onAction: (action: "start_review" | "resolve" | "dismiss") => void;
}) {
  const task = row.resident_observation_tasks;
  const actionKey = (action: string) => `${row.id}:${action}`;

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip className={statusChipClasses(row.status)}>{statusLabel(row.status)}</Chip>
            <Chip className="border-border bg-muted text-muted-foreground">
              Level {row.escalation_level}
            </Chip>
            <Chip className="border-border bg-muted text-muted-foreground">
              {row.escalation_type.replace(/_/g, " ")}
            </Chip>
            {row.watchSummary?.protocolName ? (
              <Chip className="border-info/30 bg-info/10 text-info">
                {row.watchSummary.protocolName}
              </Chip>
            ) : null}
          </div>

          <div>
            <h3 className="text-base font-semibold text-foreground">
              {residentName(row.residents, row.resident_id.slice(0, 8))}
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Triggered {new Date(row.triggered_at).toLocaleString()} ·{" "}
              {relTime(row.triggered_at)}
            </p>
          </div>

          <dl className="grid gap-3 text-[13px] text-foreground md:grid-cols-2">
            <DataPair
              label="Task status"
              value={task?.status?.replace(/_/g, " ") ?? "Unavailable"}
            />
            <DataPair
              label="Due window"
              value={
                task
                  ? `${new Date(task.due_at).toLocaleString()} → ${new Date(task.grace_ends_at).toLocaleString()}`
                  : "Unavailable"
              }
            />
            {row.watchSummary ? (
              <>
                <DataPair
                  label="Watch source"
                  value={row.watchSummary.triggeredByType.replace(/_/g, " ")}
                />
                <DataPair
                  label="Watch status"
                  value={row.watchSummary.watchStatus.replace(/_/g, " ")}
                />
              </>
            ) : null}
          </dl>

          {row.watchSummary?.incidentId ? (
            <div className="flex flex-col gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Related incident
                </p>
                <p className="text-[13px] text-foreground">
                  {row.watchSummary.incidentNumber ?? row.watchSummary.incidentId}
                  {row.watchSummary.incidentCategory
                    ? ` · ${row.watchSummary.incidentCategory.replace(/_/g, " ")}`
                    : ""}
                </p>
              </div>
              <Link
                href={`/admin/incidents/${row.watchSummary.incidentId}`}
                className="text-[12px] font-medium text-danger hover:underline"
              >
                Open incident
              </Link>
            </div>
          ) : null}

          {task?.notes ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
              <p className="text-[11px] font-medium text-muted-foreground">Task notes</p>
              <p className="mt-0.5 text-foreground">{task.notes}</p>
            </div>
          ) : null}

          {row.resolution_note ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px]">
              <p className="text-[11px] font-medium text-muted-foreground">Resolution note</p>
              <p className="mt-0.5 text-foreground">{row.resolution_note}</p>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 lg:w-[280px] lg:shrink-0">
          <div className="space-y-2">
            <label htmlFor={`note-${row.id}`} className="sr-only">
              Review note
            </label>
            <textarea
              id={`note-${row.id}`}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={3}
              placeholder="Review note or resolution context…"
              className="w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
            />

            <div className="flex flex-wrap gap-2">
              {row.status === "open" ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => onAction("start_review")}
                  disabled={actionLoading === actionKey("start_review")}
                >
                  {actionLoading === actionKey("start_review") ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ArrowRight className="size-3.5" aria-hidden />
                  )}
                  Start review
                </Button>
              ) : null}

              {(row.status === "open" || row.status === "in_progress") && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onAction("resolve")}
                    disabled={actionLoading === actionKey("resolve")}
                  >
                    {actionLoading === actionKey("resolve") ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-3.5" aria-hidden />
                    )}
                    Resolve
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onAction("dismiss")}
                    disabled={actionLoading === actionKey("dismiss")}
                  >
                    {actionLoading === actionKey("dismiss") ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <XCircle className="size-3.5" aria-hidden />
                    )}
                    Dismiss
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*  Primitives                                                                */
/* -------------------------------------------------------------------------- */

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        className,
      )}
    >
      {children}
    </span>
  );
}

function DataPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="text-[13px] text-foreground capitalize">{value}</dd>
    </div>
  );
}

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
  tone,
  message,
  onDismiss,
}: {
  tone: "success" | "info";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[13px] text-foreground",
        tone === "success" && "border-success/30 bg-success/10",
        tone === "info" && "border-info/30 bg-info/10",
      )}
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
            Escalations operate per facility
          </p>
          <p className="text-[13px] text-muted-foreground">
            Escalations are facility-scoped. Select a facility from the top bar to continue.
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

function NoEscalationsEmptyState() {
  return (
    <section
      aria-label="No open escalations"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <CheckCircle2 className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">No open escalations</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Critically overdue and missed observations will appear here when they trigger an
        escalation event.
      </p>
    </section>
  );
}

function FilterEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <section
      aria-label="No escalations match filter"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <ClipboardList className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">
        No escalations match the current filter
      </p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Adjust the filter to see other escalations.
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
