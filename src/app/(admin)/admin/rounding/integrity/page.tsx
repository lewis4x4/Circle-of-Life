"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, X } from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { IntegrityCompliancePanel } from "@/components/rounding/IntegrityCompliancePanel";
import {
  IntegrityCard,
  type BoardState,
  type IntegrityHistoryItem,
  type IntegrityRow,
  type LoadState,
  type StatusFilter,
  type Tone,
} from "@/components/rounding/IntegrityFlagCard";
import {
  RoundingEmptyNotice,
  RoundingErrorNotice,
} from "@/components/rounding/RoundingNotices";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button } from "@/components/ui/button";
import { FilterPill } from "@/components/ui/filter-pill";
import { MetricCard } from "@/components/ui/metric-card";
import {
  fetchDocumentationLagThresholds,
  type DocumentationLagThresholds,
} from "@/lib/rounding/board-policy-fetch";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  formatIntegrityNoFlagsEmptyTitle,
  formatIntegrityPageSubtitle,
  resolveIntegrityFacilityScope,
} from "@/lib/rounding/integrity-display-copy";
import { logRoundingQueryFailure } from "@/lib/rounding/rounding-query-error";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchIncidentFollowupAssignees,
  type IncidentFollowupAssigneeOption,
} from "@/lib/incidents/followup-assignees";
import { cn } from "@/lib/utils";


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
  const facilityScope = resolveIntegrityFacilityScope(
    selectedFacilityId,
    selectedFacility?.name,
  );
  const pageSubtitle = formatIntegrityPageSubtitle(facilityScope);
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
  // The documentation lag tones are this building's policy, not constants.
  // Null means the building has no facility_observation_thresholds row, and the
  // cards say so rather than colouring a lag against a number nobody chose.
  const [lagThresholds, setLagThresholds] = useState<DocumentationLagThresholds | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setRows([]);
      setLoadState("ready");
      return;
    }

    setLagThresholds(await fetchDocumentationLagThresholds(supabase, selectedFacilityId));

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
          staff!resident_observation_integrity_flags_staff_id_fkey(first_name, last_name, preferred_name),
          assigned_staff:staff!resident_observation_integrity_flags_assigned_to_staff_id_fkey(first_name, last_name, preferred_name),
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
        logRoundingQueryFailure(
          "rounding.integrity.flags",
          err,
          "Integrity flags could not be loaded. Retry, or try again in a moment.",
        ),
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
          logRoundingQueryFailure(
            "rounding.integrity.update",
            err,
            "That flag could not be updated. Confirm it is still open and retry.",
          ),
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
        subtitle={pageSubtitle}
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

          <IntegrityCompliancePanel facilityId={selectedFacilityId} />

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
            <NoFlagsEmptyState facilityScope={facilityScope} />
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
                    lagThresholds={lagThresholds}
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
    <RoundingEmptyNotice
      label="Facility scope required"
      copy={{
        why: "No building selected.",
        guidance:
          "Choose one in the top bar to see its compliance figures and the flags waiting for review.",
      }}
    />
  );
}

function LoadErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <RoundingErrorNotice message={message} onRetry={onRetry} />;
}

function NoFlagsEmptyState({
  facilityScope,
}: {
  facilityScope: ReturnType<typeof resolveIntegrityFacilityScope>;
}) {
  return (
    <RoundingEmptyNotice
      label="No integrity flags"
      copy={{
        why: `${formatIntegrityNoFlagsEmptyTitle(facilityScope)}.`,
        guidance:
          "A check recorded long after it happened, or recorded by somebody it was not assigned to, lands here for review.",
      }}
    />
  );
}

function FilterEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="space-y-2">
      <RoundingEmptyNotice
        label="No integrity flags match filter"
        copy={{
          why: "No flags match this filter.",
          guidance: "Clear it to see the rest of the queue.",
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        <X className="size-4" aria-hidden />
        Clear filter
      </Button>
    </div>
  );
}
