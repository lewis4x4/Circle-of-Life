"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { FilterPill } from "@/components/ui/filter-pill";
import { MetricCard } from "@/components/ui/metric-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill, type StatusPillTone } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
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

type StatusFilter = "all" | "open" | "reviewed_today" | "reviewed_7d" | "compliance_referred";

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

function toStatusPillTone(tone: Tone): StatusPillTone {
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  return "muted";
}

function lagMinutes(row: IntegrityRow) {
  const log = row.resident_observation_logs;
  if (!log) return null;
  const delta = Math.max(0, new Date(log.entered_at).getTime() - new Date(log.observed_at).getTime());
  return Math.round(delta / 60000);
}

function lagTone(minutes: number | null): StatusPillTone {
  if (minutes == null || minutes < 15) return "muted";
  if (minutes <= 60) return "warning";
  return "danger";
}

function lagLabel(minutes: number | null) {
  if (minutes == null) return "Unavailable";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${(minutes / 60).toFixed(1)} hr`;
  return `${(minutes / (24 * 60)).toFixed(1)} days`;
}

function resolveOpenTone(count: number): Tone {
  if (count === 0) return "default";
  if (count <= 2) return "warning";
  return "danger";
}

function resolveCriticalTone(count: number): Tone {
  return count > 0 ? "danger" : "default";
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
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const selectedFacility = availableFacilities.find((facility) => facility.id === selectedFacilityId);
  const facilityName = selectedFacility?.name ?? "selected facility";
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
      const query = supabase
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
    } catch (err) {
      setErrorMessage(
        formatLiveDataLoadError(err, "Could not load integrity flags. Confirm facility scope and retry."),
      );
      setRows([]);
      setLoadState("error");
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const today = new Date().toDateString();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      all: rows.length,
      open: rows.filter((row) => row.status === "open" || row.status === "in_progress").length,
      reviewed_today: rows.filter((row) => row.status === "resolved" && historyById[row.id]?.some((item) => new Date(item.createdAt).toDateString() === today)).length,
      reviewed_7d: rows.filter((row) => row.status === "resolved" && historyById[row.id]?.some((item) => new Date(item.createdAt).getTime() >= sevenDaysAgo)).length,
      compliance_referred: rows.filter((row) => row.status === "dismissed").length,
      critical: rows.filter((row) => row.severity === "critical").length,
    };
  }, [historyById, rows]);

  const visibleRows = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "open") return rows.filter((row) => row.status === "open" || row.status === "in_progress");
    if (filter === "compliance_referred") return rows.filter((row) => row.status === "dismissed");
    const today = new Date().toDateString();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (filter === "reviewed_today") return rows.filter((row) => row.status === "resolved" && historyById[row.id]?.some((item) => new Date(item.createdAt).toDateString() === today));
    return rows.filter((row) => row.status === "resolved" && historyById[row.id]?.some((item) => new Date(item.createdAt).getTime() >= sevenDaysAgo));
  }, [filter, historyById, rows]);

  const runAction = useCallback(
    async (id: string, action: "assign" | "start_review" | "resolve" | "dismiss") => {
      setActionLoading(`${id}:${action}`);
      setErrorMessage(null);
      setActionMessage(null);

      try {
        const note = notes[id]?.trim() ?? "";
        if (action === "dismiss" && note.length < 30) {
          setErrorMessage("Add a policy-acceptable rationale of at least 30 characters before marking this flag acceptable.");
          return;
        }

        const response = await fetch(`/api/rounding/integrity-flags/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            note: note || undefined,
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
      } catch (err) {
        setErrorMessage(
          formatLiveDataLoadError(err, "Could not update integrity flag. Confirm it is still actionable and retry."),
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
    rowCount: visibleRows.length,
    filterApplied: filter !== "all",
  });

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Documentation integrity"
        subtitle={`Late entries, retroactive documentation, and audit-evidence flags before they become survey findings at ${facilityName}.`}
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
                label="Reviewed today"
                value={counts.reviewed_today}
                tone="default"
                hint="Reviewed during today's audit work"
              />
              <KpiCard
                label="Reviewed (7 days)"
                value={counts.reviewed_7d}
                tone="default"
                hint="Reviewed in the last 7 days"
              />
              <KpiCard
                label="Compliance referred"
                value={counts.compliance_referred}
                tone="warning"
                hint="Referred or marked policy acceptable"
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
                  count={counts.all}
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
                  label="Reviewed today"
                  count={counts.reviewed_today}
                  tone="default"
                  active={filter === "reviewed_today"}
                  onClick={() => setFilter(filter === "reviewed_today" ? "all" : "reviewed_today")}
                />
                <FilterPill
                  label="Reviewed (7 days)"
                  count={counts.reviewed_7d}
                  tone="default"
                  active={filter === "reviewed_7d"}
                  onClick={() => setFilter(filter === "reviewed_7d" ? "all" : "reviewed_7d")}
                />
                <FilterPill
                  label="Compliance referred"
                  count={counts.compliance_referred}
                  tone="warning"
                  active={filter === "compliance_referred"}
                  onClick={() => setFilter(filter === "compliance_referred" ? "all" : "compliance_referred")}
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
            <NoFlagsEmptyState facilityName={facilityName} />
          ) : boardState === "empty_filtered" ? (
            <FilterEmptyState onClear={() => setFilter("all")} />
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Integrity flags">
              {visibleRows.map((row) => (
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
  const lag = lagMinutes(row);

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={toStatusPillTone(statusTone(row.status))}>{statusLabel(row.status)}</StatusPill>
            <StatusPill tone={toStatusPillTone(severityTone(row.severity))}>{row.severity}</StatusPill>
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
            <DataPair label="Recorded" value={log ? new Date(log.entered_at).toLocaleString() : new Date(row.detected_at).toLocaleString()} />
            <DataPair label="Actual occurrence" value={log ? new Date(log.observed_at).toLocaleString() : "Unavailable"} />
            <DataPair label="Recorded by" value={personName(row.staff, row.staff_id?.slice(0, 8) ?? "Unassigned")} />
            <div className="min-w-0">
              <dt className="text-[11px] font-medium text-muted-foreground">Lag</dt>
              <dd className="mt-0.5"><StatusPill tone={lagTone(lag)}>{lagLabel(lag)}</StatusPill></dd>
            </div>
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
                <Select value={assignee || "unassigned"} onValueChange={(value) => onAssigneeChange(value === "unassigned" ? "" : value)}>
                  <SelectTrigger id={`assignee-${row.id}`} className="h-10">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {assigneeOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                    Mark reviewed
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onAction("dismiss")}
                    disabled={actionLoading === actionKey("dismiss") || note.trim().length < 30}
                  >
                    {actionLoading === actionKey("dismiss") ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <XCircle className="size-3.5" aria-hidden />
                    )}
                    Mark as policy-acceptable
                  </Button>
                </>
              )}
              <Link
                href={`/admin/compliance?integrityFlagId=${row.id}`}
                className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Refer to compliance
              </Link>
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
  const thresholds = label === "Open" || label === "Critical" ? ({ type: "critical-count" } as const) : ({ type: "informational" } as const);
  return <MetricCard label={label} value={value} numericValue={value} thresholds={thresholds} tone={tone === "default" ? undefined : tone} hint={hint} />;
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

function NoFlagsEmptyState({ facilityName }: { facilityName: string }) {
  return (
    <section
      aria-label="No integrity flags"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <ShieldAlert className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">No integrity flags at {facilityName}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Late or retroactive entries will appear here for review before they become survey findings.
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
