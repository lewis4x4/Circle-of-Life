"use client";

/**
 * Incident Reports Log (spec 07A §6.2 `v_incident_reports_log`, §7 Tier 3,
 * §9 item 10, Appendix A). The paper log's columns in the paper log's order
 * for one facility and one month, with a CSV download of the same cells.
 * Month navigation is previous/next buttons plus the month name; no native
 * date input. Explicit state machine, one state on screen at a time.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Download } from "lucide-react";

import {
  AdminEmptyState,
  AdminErrorState,
  AdminOperationalListPanel,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { triggerCsvDownload } from "@/lib/csv-export";
import {
  INCIDENT_REPORTS_LOG_COLUMNS,
  INCIDENT_REPORTS_LOG_MARK_COLUMNS,
  buildIncidentReportsLogCsv,
  currentYearMonth,
  incidentReportsLogCells,
  incidentReportsLogFileName,
  monthRange,
  type IncidentReportsLogRow,
} from "@/lib/incidents/reports-log";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

type FacilityInfo = { id: string; name: string | null; timeZone: string };

type LogState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success-empty" }
  | { status: "success-populated"; rows: IncidentReportsLogRow[] };

const DEFAULT_TIME_ZONE = "America/New_York";

export default function IncidentReportsLogPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const facilityId = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;

  const [facility, setFacility] = useState<FacilityInfo | null>(null);
  const [yearMonth, setYearMonth] = useState<string | null>(null);
  const [state, setState] = useState<LogState>({ status: "idle" });

  useEffect(() => {
    if (!facilityId) return;
    let cancelled = false;
    supabase
      .from("facilities")
      .select("id, name, timezone")
      .eq("id", facilityId)
      .maybeSingle()
      .then(
        (result) => {
          if (cancelled) return;
          const timeZone = result.data?.timezone?.trim() || DEFAULT_TIME_ZONE;
          setFacility({ id: facilityId, name: result.data?.name ?? null, timeZone });
          // Default to the facility's current month; a month already chosen stays.
          setYearMonth((current) => current ?? currentYearMonth(timeZone));
        },
        () => {
          if (cancelled) return;
          setFacility({ id: facilityId, name: null, timeZone: DEFAULT_TIME_ZONE });
          setYearMonth((current) => current ?? currentYearMonth(DEFAULT_TIME_ZONE));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [facilityId, supabase]);

  const range = useMemo(
    () => (yearMonth && facility ? monthRange(yearMonth, facility.timeZone) : null),
    [facility, yearMonth],
  );

  const load = useCallback(() => {
    if (!facility || !range) return;
    setState({ status: "loading" });
    supabase
      .from("v_incident_reports_log")
      .select("*")
      .eq("facility_id", facility.id)
      .gte("log_date", range.firstDate)
      .lte("log_date", range.lastDate)
      .order("occurred_at", { ascending: true })
      .limit(1000)
      .then((result) => {
        if (result.error) {
          setState({ status: "error", message: formatLiveDataLoadError(result.error, "The reports log is unavailable right now.") });
          return;
        }
        const rows = result.data ?? [];
        setState(rows.length === 0 ? { status: "success-empty" } : { status: "success-populated", rows });
      });
  }, [facility, range, supabase]);

  useEffect(() => {
    // Defer so the loading transition happens in a callback, not in the effect body.
    queueMicrotask(load);
  }, [load]);

  const download = useCallback(() => {
    if (state.status !== "success-populated" || !range) return;
    triggerCsvDownload(incidentReportsLogFileName(facility?.name, range.yearMonth), buildIncidentReportsLogCsv(state.rows));
  }, [facility?.name, range, state]);

  return (
    <div className="flex max-w-[1440px] flex-col gap-4 pb-8 pt-2">
      <div className="flex flex-col gap-2">
        <Link
          prefetch={false}
          href="/admin/incidents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit gap-1")}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Incidents
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Incident reports log</h1>
        <p className="text-sm text-muted-foreground">
          The monthly log a surveyor expects: one line per incident with the injury marks, contributing factors, and shift.
        </p>
      </div>

      {!facilityId ? (
        <AdminEmptyState
          title="Choose a facility"
          description="The reports log is kept per building. Pick a facility in the header to see its month."
        />
      ) : (
        <AdminOperationalListPanel
          toolbar={
            <>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous month"
                  disabled={!range}
                  onClick={() => range && setYearMonth(range.previousYearMonth)}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <span className="min-w-36 text-center text-sm font-medium text-foreground" aria-live="polite">
                  {range?.label ?? "Loading month"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next month"
                  disabled={!range}
                  onClick={() => range && setYearMonth(range.nextYearMonth)}
                >
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={state.status !== "success-populated"}
                onClick={download}
              >
                <Download className="size-4" aria-hidden />
                Download CSV
              </Button>
            </>
          }
        >
          <ReportsLogBody state={state} onRetry={load} monthLabel={range?.label ?? null} />
        </AdminOperationalListPanel>
      )}
    </div>
  );
}

function ReportsLogBody({ state, onRetry, monthLabel }: { state: LogState; onRetry: () => void; monthLabel: string | null }) {
  if (state.status === "idle" || state.status === "loading") {
    return <AdminTableLoadingState className="rounded-none border-0 ring-0" />;
  }
  if (state.status === "error") {
    return (
      <div className="p-3">
        <AdminErrorState title="Could not load the reports log" message={state.message} onRetry={onRetry} />
      </div>
    );
  }
  if (state.status === "success-empty") {
    return (
      <div className="p-3">
        <AdminEmptyState
          title={monthLabel ? `No incidents logged for ${monthLabel}` : "No incidents logged"}
          description="Incidents reported through Something happened and the incident form appear here on the day they occurred."
        />
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {INCIDENT_REPORTS_LOG_COLUMNS.map((column) => (
              <TableHead
                key={column}
                className={cn("whitespace-nowrap", INCIDENT_REPORTS_LOG_MARK_COLUMNS.has(column) && "text-center")}
              >
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {state.rows.map((row) => {
            const cells = incidentReportsLogCells(row);
            return (
              <TableRow key={row.incident_id ?? `${row.occurred_at}-${row.room}`}>
                {cells.map((cell, index) => {
                  const column = INCIDENT_REPORTS_LOG_COLUMNS[index];
                  const isMark = INCIDENT_REPORTS_LOG_MARK_COLUMNS.has(column);
                  return (
                    <TableCell key={column} className={cn(isMark && "text-center", column === "Contributing factors" && "min-w-56 whitespace-normal")}>
                      {isMark ? (
                        cell ? (
                          <>
                            <span aria-hidden>{cell}</span>
                            <span className="sr-only">Yes</span>
                          </>
                        ) : (
                          <span className="sr-only">No</span>
                        )
                      ) : (
                        cell
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
