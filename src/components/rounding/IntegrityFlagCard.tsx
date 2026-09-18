"use client";

/**
 * One documentation integrity flag, and the review actions on it.
 *
 * Split out of the Integrity page so both stay inside the constitution's
 * component budget. Nothing about the behaviour changed in the move.
 *
 * The staff names on this card arrive from two separate embeds of `staff`,
 * because the flag table holds a foreign key for the person who recorded the
 * check and another for the person who owns the review. Both embeds name their
 * constraint: a bare `staff(...)` is ambiguous across two relationships and
 * PostgREST answers `PGRST201`, which is why this tab used to fail to load.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Eye, Loader2, UserSearch, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DocumentationLagThresholds } from "@/lib/rounding/board-policy-fetch";
import { MINUTES_PER_DAY, MINUTES_PER_HOUR, minutesFromMs } from "@/lib/rounding/duration-units";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill, type StatusPillTone } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import type { IncidentFollowupAssigneeOption } from "@/lib/incidents/followup-assignees";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type FollowUpStatus = "open" | "in_progress" | "resolved" | "dismissed";
export type Severity = "low" | "medium" | "high" | "critical";

export type IntegrityRow = {
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

export type IntegrityHistoryItem = {
  id: string;
  action: string;
  changedFields: string[];
  actorName: string;
  createdAt: string;
};

export type LoadState = "idle" | "loading" | "ready" | "error";

export type BoardState =
  | "no_facility"
  | "loading"
  | "error"
  | "empty"
  | "empty_filtered"
  | "populated";

export type Tone = "default" | "warning" | "danger";

export type StatusFilter = "all" | "open" | "reviewed_today" | "reviewed_7d" | "compliance_referred";

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
  return minutesFromMs(delta);
}

/**
 * How concerning a documentation lag reads.
 *
 * The two thresholds are rows, `facility_observation_thresholds.
 * documentation_lag_notable_minutes` and `documentation_lag_serious_minutes`,
 * added by migration 431. They were constants here until Part 8, and they are
 * facility policy rather than engineering constants: a building deciding what
 * counts as a notable gap between observing a resident and writing it down is
 * an operator judgment, and this is the severity a surveyor reads.
 *
 * A building with no thresholds row reads neutral. There is no defensible
 * default for "how late is concerning here", so the surface says it does not
 * know instead of picking a number.
 */
function lagTone(minutes: number | null, thresholds: DocumentationLagThresholds | null): StatusPillTone {
  if (minutes == null || thresholds == null) return "muted";
  if (minutes < thresholds.notableMinutes) return "muted";
  if (minutes <= thresholds.seriousMinutes) return "warning";
  return "danger";
}

function lagLabel(minutes: number | null, thresholds: DocumentationLagThresholds | null) {
  if (minutes == null) return "Unavailable";
  if (thresholds == null) return `${minutes} min, no threshold set`;
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`;
  if (minutes < MINUTES_PER_DAY) return `${(minutes / MINUTES_PER_HOUR).toFixed(1)} hr`;
  return `${(minutes / MINUTES_PER_DAY).toFixed(1)} days`;
}

export function IntegrityCard({
  row,
  note,
  assignee,
  assigneeOptions,
  history,
  lagThresholds,
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
  /** Null when this building has no facility_observation_thresholds row. */
  lagThresholds: DocumentationLagThresholds | null;
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
              <dd className="mt-0.5"><StatusPill tone={lagTone(lag, lagThresholds)}>{lagLabel(lag, lagThresholds)}</StatusPill></dd>
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
            <Textarea
              id={`note-${row.id}`}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={3}
              placeholder="Review note or disposition…"
              className="resize-none text-[13px]"
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
