"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { fetchRegister } from "@/lib/registers/load-register";
import { FacilityGateNotice } from "@/components/common/FacilityGate";
import {
  REGISTER_EMPTY_COPY,
  registerCountsLine,
  registerEventLabel,
  registerRoomLabel,
  residentStatusLabel,
  type RegisterRow,
} from "@/lib/registers/register";
import {
  easternDayEndIso,
  easternDayStartIso,
  formatRegisterEventTime,
  isCompleteDateInput,
} from "@/lib/registers/register-display-copy";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

type Props = {
  organizationId: string;
  facilityId: string | null;
  initialRows: RegisterRow[];
  initialFrom: string;
  initialTo: string;
  loadError: string | null;
};

/**
 * Tier 1 is the log itself: a range, a bed-hold toggle, and a dense table.
 * Tier 2 is one row opened, which says where the event came from and links to
 * the flow that would correct it. Tier 3 is the resident's own status history,
 * which already exists on the resident record, so this page links there rather
 * than growing a third copy of it.
 */
export function RegisterClient({
  organizationId,
  facilityId,
  initialRows,
  initialFrom,
  initialTo,
  loadError,
}: Props) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [includeHolds, setIncludeHolds] = useState(true);
  const [rows, setRows] = useState<RegisterRow[]>(initialRows);
  const [error, setError] = useState<string | null>(loadError);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(
    async (next: { from: string; to: string; includeHolds: boolean }) => {
      if (!facilityId) return;
      // Clearing a date field fires onChange with "". Asking the database about
      // an empty range throws, and the operator reads "could not be loaded"
      // when the truth is that they are mid-edit.
      if (!isCompleteDateInput(next.from) || !isCompleteDateInput(next.to)) {
        setError("Choose a start and end date for the register.");
        return;
      }
      try {
        const supabase = createClient();
        const fetched = await fetchRegister(supabase, {
          organizationId,
          facilityId,
          from: easternDayStartIso(next.from),
          to: easternDayEndIso(next.to),
          includeHolds: next.includeHolds,
        });
        setRows(fetched);
        setError(null);
      } catch {
        setError("The register could not be loaded.");
      }
    },
    [facilityId, organizationId],
  );

  // A facility switch has to refetch: the rows on screen belong to the building
  // that was selected when they were fetched. The first render is not a switch,
  // though - the server already fetched for this facility, and refetching on
  // mount would blank the table and ask the database the same question twice.
  const fetchedFor = useRef(facilityId);
  useEffect(() => {
    if (fetchedFor.current === facilityId) return;
    fetchedFor.current = facilityId;
    startTransition(() => {
      void load({ from, to, includeHolds });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilityId]);

  const countsLine = useMemo(() => registerCountsLine(rows), [rows]);

  function apply(next: Partial<{ from: string; to: string; includeHolds: boolean }>) {
    const merged = { from, to, includeHolds, ...next };
    setFrom(merged.from);
    setTo(merged.to);
    setIncludeHolds(merged.includeHolds);
    startTransition(() => {
      void load(merged);
    });
  }

  if (!facilityId) {
    return <FacilityGateNotice reason="The admission and discharge register is kept per building." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="register-from" className="text-xs text-muted-foreground">
            From
          </label>
          <input
            id="register-from"
            type="date"
            value={from}
            onChange={(event) => apply({ from: event.target.value })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="register-to" className="text-xs text-muted-foreground">
            To
          </label>
          <input
            id="register-to"
            type="date"
            value={to}
            onChange={(event) => apply({ to: event.target.value })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={includeHolds}
            onChange={(event) => apply({ includeHolds: event.target.checked })}
            className="h-4 w-4 rounded border-input"
          />
          Show bed holds
        </label>
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {countsLine || "No events in this range."}
      </p>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {rows.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">{REGISTER_EMPTY_COPY}</p>
      ) : (
        <HorizontalScroll label="Register">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">
              Admissions, discharges and bed holds recorded in Haven for this range
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">Time</th>
                <th scope="col" className="py-2 pr-3 font-medium">Event</th>
                <th scope="col" className="py-2 pr-3 font-medium">Resident</th>
                <th scope="col" className="py-2 pr-3 font-medium">Room</th>
                <th scope="col" className="py-2 pr-3 font-medium">From</th>
                <th scope="col" className="py-2 pr-3 font-medium">To</th>
                <th scope="col" className="py-2 pr-3 font-medium">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = `${row.residentId}-${row.eventAt}-${row.eventType}`;
                const open = openRow === key;
                return (
                  <tr key={key} className="border-b border-border align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {formatRegisterEventTime(row.eventAt)}
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => setOpenRow(open ? null : key)}
                        aria-expanded={open}
                        className="text-left font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {registerEventLabel(row.eventType)}
                      </button>
                      {open ? (
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {row.admissionSource ? <p>Admission source: {row.admissionSource}</p> : null}
                          {row.dischargeReason ? (
                            <p>
                              Discharge reason: {row.dischargeReason.replace(/_/g, " ")}
                              {row.dischargeDestination ? ` to ${row.dischargeDestination}` : ""}
                            </p>
                          ) : null}
                          <p>
                            This row is derived from the resident&rsquo;s status history. To change it,
                            correct the status on the resident record.
                          </p>
                          <p className="flex flex-wrap gap-3">
                            <Link href={`/admin/residents/${row.residentId}`} className="underline">
                              Resident record
                            </Link>
                            <Link href={`/admin/residents/${row.residentId}/timeline`} className="underline">
                              Full status history
                            </Link>
                          </p>
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-foreground">{row.residentDisplayName}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {registerRoomLabel(row)}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {residentStatusLabel(row.fromStatus)}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {residentStatusLabel(row.toStatus)}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{row.recordedByName ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </HorizontalScroll>
      )}

      <p className="text-xs text-muted-foreground">
        Room is where the resident is now. Haven does not record which bed a resident held at the time
        of an older event.
      </p>
      <Link
        href="/admin/compliance/survey-pack"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        Survey print pack
      </Link>
    </div>
  );
}
