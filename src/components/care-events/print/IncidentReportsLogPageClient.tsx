"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { FacilityGateNotice, useFacilityGateScope } from "@/components/common/FacilityGate";
import {
  fetchIncidentReportsLog,
  fetchPrintFacility,
  type IncidentReportsLogRow,
  type PrintFacility,
} from "@/lib/care-events/print-data";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE } from "@/lib/supabase/env";

import { IncidentReportsLogSheet } from "./IncidentReportsLogSheet";
import { PrintGate } from "./PrintGate";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** First and last day of the month containing `today`, in that facility's clock. */
function defaultRange(today: Date): { from: string; to: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * `/admin/incidents/print/log?facility=&from=&to=` — the paper Incident Reports
 * Log for one facility and range. Defaults to the current month when the range
 * is missing or malformed, rather than printing an empty sheet.
 */
export function IncidentReportsLogPageClient() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();

  // A `?facility=` link from the board wins; otherwise print for the header's
  // facility (COL-651: the page used to refuse unless opened from the board).
  const { facilityId: scopeFacilityId } = useFacilityGateScope();
  const queryFacilityId = searchParams.get("facility") ?? "";
  const facilityId = UUID_STRING_RE.test(queryFacilityId) ? queryFacilityId : (scopeFacilityId ?? "");
  const fallback = useMemo(() => defaultRange(new Date()), []);
  const from = DATE_RE.test(searchParams.get("from") ?? "") ? (searchParams.get("from") as string) : fallback.from;
  const to = DATE_RE.test(searchParams.get("to") ?? "") ? (searchParams.get("to") as string) : fallback.to;

  const [facility, setFacility] = useState<PrintFacility | null>(null);
  const [rows, setRows] = useState<IncidentReportsLogRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Whether the query named a building is known at render. Only the load
  // failure is state.
  const validFacility = UUID_STRING_RE.test(facilityId);
  const error = validFacility ? loadError : null;

  useEffect(() => {
    if (!validFacility) return;
    let cancelled = false;
    Promise.all([fetchPrintFacility(supabase, facilityId), fetchIncidentReportsLog(supabase, { facilityId, from, to })])
      .then(([loadedFacility, loadedRows]) => {
        if (cancelled) return;
        setFacility(loadedFacility);
        setRows(loadedRows);
      })
      .catch(() => {
        if (!cancelled) setLoadError("That log could not be loaded. The building may be outside your facilities.");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, facilityId, from, to, validFacility]);

  if (!validFacility) {
    return (
      <div className="p-6">
        <FacilityGateNotice
          title="Incident reports log"
          reason="The paper log prints one building's incidents for the month."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 p-6">
        <p role="alert" className="text-base font-medium text-destructive">
          {error}
        </p>
        <Link href="/admin/incidents" className="text-sm underline-offset-4 hover:underline">
          Back to the incidents board
        </Link>
      </div>
    );
  }

  return (
    <PrintGate supabase={supabase} kind="incident_reports_log" facilityId={facilityId} from={from} to={to}>
      {facility === null || rows === null ? (
        <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Loading the log
        </p>
      ) : (
        <IncidentReportsLogSheet facility={facility} rows={rows} from={from} to={to} />
      )}
    </PrintGate>
  );
}
