"use client";

/**
 * "This shift's events" on the caregiver handoff page (spec 07A §6.3). The
 * live view of the outgoing shift's care events grouped by level word, built
 * by the same pure builder that recordShiftHandoff writes into
 * shift_handoffs.auto_summary when the caregiver taps Record handoff.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HANDOFF_NO_EVENTS_COPY,
  buildShiftHandoffAutoSummary,
  loadOutgoingShiftCareEvents,
  shiftWindowOf,
  type HandoffAutoSummary,
} from "@/lib/caregiver/handoff-summary";
import { currentShiftFor, handoffShiftOf, type FacilityShiftDefinition } from "@/lib/caregiver/shift";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";

type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success-empty"; shiftWord: string }
  | { status: "success-populated"; shiftWord: string; summary: HandoffAutoSummary };

type ShiftEventsSummaryProps = {
  facilityId: string;
  timeZone: string;
  /** The facility's configured shifts (`CaregiverFacilityContext.shifts`); the header and the handoff record read the same ones. */
  shifts?: readonly FacilityShiftDefinition[] | null;
};

export function ShiftEventsSummary({ facilityId, timeZone, shifts }: ShiftEventsSummaryProps) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<SummaryState>({ status: "idle" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    const current = currentShiftFor({ timeZone, shifts }, new Date());
    const shift = handoffShiftOf(current, timeZone);
    const date = current.serviceDate;
    const shiftWord = current.label;
    loadOutgoingShiftCareEvents(supabase, facilityId, shiftWindowOf(current))
      .then((careEvents) => {
        if (careEvents.length === 0) {
          setState({ status: "success-empty", shiftWord });
          return;
        }
        setState({
          status: "success-populated",
          shiftWord,
          summary: buildShiftHandoffAutoSummary({ careEvents, timeZone, shift, date }),
        });
      })
      .catch((error: unknown) => {
        setState({ status: "error", message: formatLiveDataLoadError(error, "This shift's events are unavailable right now.") });
      });
  }, [facilityId, shifts, supabase, timeZone]);

  useEffect(() => {
    // Defer so the loading transition happens in a callback, not in the effect body.
    queueMicrotask(load);
  }, [load]);

  return (
    <section aria-label="This shift's events" className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">This shift&apos;s events</h3>
        {state.status === "success-empty" || state.status === "success-populated" ? (
          <span className="text-sm text-muted-foreground">{state.shiftWord} shift</span>
        ) : null}
      </div>

      {state.status === "idle" || state.status === "loading" ? (
        <div className="mt-3 flex flex-col gap-2" role="status" aria-live="polite" aria-label="Loading this shift's events">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className="mt-3 flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <div>
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={load}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {state.status === "success-empty" ? (
        <p className="mt-3 text-sm text-muted-foreground">{HANDOFF_NO_EVENTS_COPY}</p>
      ) : null}

      {state.status === "success-populated" ? (
        <ol className="mt-3 flex flex-col gap-2">
          {state.summary.lines.map((line, index) => (
            <li key={`${index}-${line}`} className="text-sm text-foreground">
              {line}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
