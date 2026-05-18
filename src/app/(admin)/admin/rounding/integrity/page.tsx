"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardList,
  Eye,
  Loader2,
  RefreshCw,
  ShieldAlert,
  UserSearch,
  X,
  XCircle,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchIncidentFollowupAssignees,
  type IncidentFollowupAssigneeOption,
} from "@/lib/incidents/followup-assignees";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type FollowUpStatus = "open" | "in_progress" | "resolved" | "dismissed";
type Severity = "low" | "medium" | "high" | "critical";

type IntegrityRow = {
  id: string;
  resident_id: string | null;
  staff_id: string | null;
  log_id: string | null;
  assigned_to_staff_id: string | null;
  assigned_at: string | null;
  flag_type: string;
  severity: Severity;
  detected_at: string;
  status: FollowUpStatus;
  disposition_note: string | null;
  residents?: {
    first_name: string;
    last_name: string;
    preferred_name: string | null;
  } | null;
  staff?: { first_name: string; last_name: string; preferred_name: string | null } | null;
  assigned_staff?: {
    first_name: string;
    last_name: string;
    preferred_name: string | null;
  } | null;
  resident_observation_logs?: {
    quick_status: string;
    entry_mode: string;
    observed_at: string;
    entered_at: string;
    late_reason: string | null;
    note: string | null;
  } | null;
};

type IntegrityHistoryItem = {
  id: string;
  action: string;
  changedFields: string[];
  actorName: string;
  createdAt: string;
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

function personName(
  row:
    | { first_name: string; last_name: string; preferred_name: string | null }
    | null
    | undefined,
  fallback: string,
) {
  if (!row) return fallback;
  return row.preferred_name?.trim() || `${row.first_name} ${row.last_name}`;
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

function severityTone(severity: Severity): Tone {
  if (severity === "critical") return "danger";
  if (severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "default";
}

function chipClasses(tone: Tone): string {
  if (tone === "danger") return "border-danger/30 bg-danger/10 text-danger";
  if (tone === "warning") return "border-warning/30 bg-warning/10 text-warning";
  return "border-border bg-muted text-muted-foreground";
}

function resolveOpenTone(count: number): Tone {
  if (count === 0) return "default";
  if (count <= 2) return "warning";
  return "danger";
}

function resolveCriticalTone(count: number): Tone {
  return count > 0 ? "danger" : "default";
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

export default function RoundingIntegrityPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<IntegrityRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [assigneeDrafts, setAssigneeDrafts] = useState<Record<string, string>>({});
  const [assigneeOptions, setAssigneeOptions] = useState<IncidentFollowupAssigneeOption[]>([]);
  const [historyById, setHistoryById] = useState<Record<string, IntegrityHistoryItem[]>>({});
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
        .from("resident_observation_integrity_flags" as never)
        .select(
          `
          id,
          resident_id,
          staff_id,
          log_id,
          assigned_to_staff_id,
          assigned_at,
          flag_type,
          severity,
          detected_at,
          status,
          disposition_note,
          residents(first_name, last_name, preferred_name),
          staff(first_name, last_name, preferred_name),
          assigned_staff:assigned_to_staff_id(first_name, last_name, preferred_name),
          resident_observation_logs(quick_status, entry_mode, observed_at, entered_at, late_reason, note)
        `,
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("detected_at", { ascending: false })
        .limit(100);

      if (filter !== "all") query = query.eq("status", filter);

      const { data, error } = await query;
      if (error) throw error;
      const nextRows = (data ?? []) as unknown as IntegrityRow[];
      setRows(nextRows);
      setAssigneeDrafts(
        Object.fromEntries(nextRows.map((row) => [row.id, row.assigned_to_staff_id ?? ""])),
      );

      try {
        const options = await fetchIncidentFollowupAssignees(selectedFacilityId);
        setAssigneeOptions(options);
      } catch {
        setAssigneeOptions([]);
      }

      if (nextRows.length > 0) {
        const ids = nextRows.map((row) => row.id).join(",");
        const response = await fetch(
          `/api/rounding/integrity-flags/history?facilityId=${encodeURIComponent(selectedFacilityId)}&ids=${encodeURIComponent(ids)}`,
          { method: "GET", cache: "no-store" },
        );
        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              historyById?: Record<string, IntegrityHistoryItem[]>;
              error?: string;
            }
          | null;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Could not load integrity history.");
        }
        setHistoryById(payload.historyById ?? {});
      } else {
        setHistoryById({});
      }

      setLoadState("ready");
    } catch (loadError) {
      setErrorMessage(
        loadError instanceof Error ? loadError.message : "Could not load integrity flags.",
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
      critical: rows.filter((row) => row.severity === "critical").length,
    }),
    [rows],
  );

  const runAction = useCallback(
    async (id: string, action: "assign" | "start_review" | "resolve" | "dismiss") => {
      setActionLoading(`${id}:${action}`);
      setErrorMessage(null);
      setActionMessage(null);

      try {
        const response = await fetch(`/api/rounding/integrity-flags/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            note: notes[id]?.trim() || undefined,
            assignedStaffId: action === "assign" ? assigneeDrafts[id] || null : undefined,
          }),
        });

        const json = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(json.error ?? "Could not update integrity flag");

        setActionMessage(
          action === "assign"
            ? "Integrity flag assignment saved."
            : action === "start_review"
              ? "Integrity flag moved into review."
              : action === "resolve"
                ? "Integrity flag resolved."
                : "Integrity flag dismissed.",
        );
        setNotes((current) => ({ ...current, [id]: "" }));
        await load();
      } catch (runError) {
        setErrorMessage(
          runError instanceof Error ? runError.message : "Could not update integrity flag.",
        );
      } finally {
        setActionLoading(null);
      }
    },
    [assigneeDrafts, load, notes],
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
        title="Documentation integrity"
        subtitle="Late-entry and documentation-quality flags — review and disposition before rounding evidence becomes hard to defend."
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void load()}
            aria-label="Refresh integrity flags"
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
          message={errorMessage ?? "Could not load integrity flags."}
          onRetry={() => void load()}
        />
      ) : (
        <>
          {actionMessage ? (
            <InfoBanner message={actionMessage} onDismiss={() => setActionMessage(null)} />
          ) : null}

          {/* KPI strip */}
          <section aria-label="Integrity flag summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
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
                hint="Under review"
              />
              <KpiCard
                label="Resolved"
                value={counts.resolved}
                tone="default"
                hint="Closed flags"
              />
              <KpiCard
                label="Dismissed"
                value={counts.dismissed}
                tone="default"
                hint="Reviewed and dismissed"
              />
              <KpiCard
                label="Critical"
                value={counts.critical}
                tone={resolveCriticalTone(counts.critical)}
                hint="Highest severity"
              />
            </div>
          </section>

          {/* Filter pills */}
          <section aria-label="Filter integrity flags">
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
            <NoFlagsEmptyState />
          ) : boardState === "empty_filtered" ? (
            <FilterEmptyState onClear={() => setFilter("all")} />
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Integrity flags">
              {rows.map((row) => (
                <li key={row.id}>
                  <IntegrityCard
                    row={row}
                    note={notes[row.id] ?? ""}
                    assignee={assigneeDrafts[row.id] ?? ""}
                    assigneeOptions={assigneeOptions}
                    history={historyById[row.id] ?? []}
                    actionLoading={actionLoading}
                    onNoteChange={(value) =>
                      setNotes((current) => ({ ...current, [row.id]: value }))
                    }
                    onAssigneeChange={(value) =>
                      setAssigneeDrafts((current) => ({ ...current, [row.id]: value }))
                    }
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
/*  Integrity card                                                             */
/* -------------------------------------------------------------------------- */

function IntegrityCard({
  row,
  note,
  assignee,
  assigneeOptions,
  history,
  actionLoading,
  onNoteChange,
  onAssigneeChange,
  onAction,
}: {
  row: IntegrityRow;
  note: string;
  assignee: string;
  assigneeOptions: IncidentFollowupAssigneeOption[];
  history: IntegrityHistoryItem[];
  actionLoading: string | null;
  onNoteChange: (value: string) => void;
  onAssigneeChange: (value: string) => void;
  onAction: (action: "assign" | "start_review" | "resolve" | "dismiss") => void;
}) {
  const log = row.resident_observation_logs;
  const actionKey = (action: string) => `${row.id}:${action}`;

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip className={chipClasses(statusTone(row.status))}>
              {statusLabel(row.status)}
            </Chip>
            <Chip className={chipClasses(severityTone(row.severity))}>{row.severity}</Chip>
            <Chip className="border-border bg-muted text-muted-foreground">
              {row.flag_type.replace(/_/g, " ")}
            </Chip>
          </div>

          <div>
            <h3 className="text-base font-semibold text-foreground">
              {personName(row.residents, row.resident_id?.slice(0, 8) ?? "No resident linked")}
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Staff: {personName(row.staff, row.staff_id?.slice(0, 8) ?? "Unassigned")}
            </p>
            <p className="text-[12px] text-muted-foreground">
              Owner: {personName(row.assigned_staff, row.assigned_to_staff_id ?? "Unassigned")}
              {row.assigned_at ? ` · assigned ${new Date(row.assigned_at).toLocaleString()}` : ""}
            </p>
          </div>

          <dl className="grid gap-3 text-[13px] text-foreground md:grid-cols-2">
            <DataPair label="Detected" value={new Date(row.detected_at).toLocaleString()} />
            <DataPair
              label="Entry mode"
              value={log?.entry_mode?.replace(/_/g, " ") ?? "Unavailable"}
            />
            <DataPair
              label="Observed"
              value={log ? new Date(log.observed_at).toLocaleString() : "Unavailable"}
            />
            <DataPair
              label="Entered"
              value={log ? new Date(log.entered_at).toLocaleString() : "Unavailable"}
            />
          </dl>

          {log?.late_reason ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground">
              <p className="text-[11px] font-medium text-muted-foreground">Late reason</p>
              <p>{log.late_reason}</p>
            </div>
          ) : null}

          {log?.note ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground">
              <p className="text-[11px] font-medium text-muted-foreground">Observation note</p>
              <p>{log.note}</p>
            </div>
          ) : null}

          {row.disposition_note ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground">
              <p className="text-[11px] font-medium text-muted-foreground">Disposition note</p>
              <p>{row.disposition_note}</p>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 lg:w-[280px] lg:shrink-0">
          <div className="space-y-3">
            <label htmlFor={`note-${row.id}`} className="sr-only">
              Review note
            </label>
            <textarea
              id={`note-${row.id}`}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={3}
              placeholder="Review note or disposition…"
              className="w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
            />

            {assigneeOptions.length > 0 ? (
              <div className="space-y-2">
                <label
                  htmlFor={`assignee-${row.id}`}
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Assigned owner
                </label>
                <select
                  id={`assignee-${row.id}`}
                  value={assignee}
                  onChange={(event) => onAssigneeChange(event.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground shadow-sm transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                >
                  <option value="">Unassigned</option>
                  {assigneeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onAction("assign")}
                  disabled={actionLoading === actionKey("assign")}
                >
                  {actionLoading === actionKey("assign") ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <UserSearch className="size-3.5" aria-hidden />
                  )}
                  Save owner
                </Button>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
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
                    <Eye className="size-3.5" aria-hidden />
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

            {history.length > 0 ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <p className="text-[11px] font-medium text-muted-foreground">History</p>
                <ul className="mt-1 space-y-1 text-[12px] text-foreground">
                  {history.slice(0, 4).map((item) => (
                    <li key={item.id}>
                      <span className="font-medium capitalize">
                        {item.action.replace(/_/g, " ")}
                      </span>
                      {item.changedFields.length > 0
                        ? ` · ${item.changedFields.join(", ")}`
                        : ""}
                      <span className="text-muted-foreground">
                        {` · ${item.actorName} · ${new Date(item.createdAt).toLocaleString()}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
            Integrity review operates per facility
          </p>
          <p className="text-[13px] text-muted-foreground">
            Documentation integrity flags are facility-scoped. Select a facility from the top
            bar to continue.
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

function NoFlagsEmptyState() {
  return (
    <section
      aria-label="No integrity flags"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <ShieldAlert className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">No integrity flags</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Late-entry and documentation-quality issues will appear here as the integrity scanner
        detects them.
      </p>
    </section>
  );
}

function FilterEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <section
      aria-label="No integrity flags match filter"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <ClipboardList className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">
        No flags match the current filter
      </p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Adjust the filter to see other integrity flags.
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
