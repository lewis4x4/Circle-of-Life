"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  deriveCareEvent,
  type CareEventContext,
  type CareEventDerivation,
  type CareEventKind,
} from "@/lib/care-events/level-engine";
import { fetchResidentReportContext, type ResidentReportContext } from "@/lib/care-events/report-data";
import {
  answersForEngine,
  initialReportState,
  occurredAtIso,
  reportReducer,
  type ReportResident,
} from "@/lib/care-events/report-state";
import {
  buildSubmitPayload,
  describeSubmitFailure,
  isLikelyNetworkError,
  parseCareEventReceipt,
  submitCareEvent,
} from "@/lib/care-events/submit";
import { queueCareEvent, subscribeCareEventQueue } from "@/lib/offline/care-event-queue";

import { useReportFlowData } from "./useReportFlowData";

function timeLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/**
 * The "Something happened" flow's state, level derivation and send path
 * (spec 07A §2, §6.4), shared by `/caregiver/report` and the floor tablet's
 * `/floor/report` (spec 40 §6), which only lay it out differently. The level
 * engine runs on every answer change; the server derives it again and never
 * trusts the client's level.
 */
export function useCareEventReport({
  prefillResidentId,
  prefillKind,
}: {
  prefillResidentId: string | null;
  prefillKind: CareEventKind | null;
}) {
  const { supabase, data, retry } = useReportFlowData();
  const [clientEventId] = useState(() => crypto.randomUUID());
  const [state, dispatch] = useReducer(reportReducer, clientEventId, initialReportState);
  const [residentContext, setResidentContext] = useState<{ residentId: string; context: ResidentReportContext } | null>(null);
  const prefilled = useRef(false);

  const ready = data.status === "ready" ? data : null;

  // Apply the URL prefill once the census is known (resident must be at this facility).
  useEffect(() => {
    if (!ready || prefilled.current) return;
    prefilled.current = true;
    const resident: ReportResident | null = prefillResidentId
      ? (ready.everyone.find((candidate) => candidate.id === prefillResidentId) ?? null)
      : null;
    if (resident || prefillKind) dispatch({ type: "prefill", resident, kind: prefillKind });
  }, [ready, prefillResidentId, prefillKind]);

  // Resident risk context tunes the level (active watch, elopement risk, prior bruise).
  const residentId = state.resident?.id ?? null;
  useEffect(() => {
    if (!residentId) return;
    let cancelled = false;
    fetchResidentReportContext(supabase, residentId)
      .then((context) => {
        if (!cancelled) setResidentContext({ residentId, context });
      })
      .catch(() => {
        // Missing context only means fewer raises; the server derives with the full context.
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, residentId]);

  const occurredAt = useMemo(() => occurredAtIso(state), [state]);
  const derivation: CareEventDerivation | null = useMemo(() => {
    if (!state.kind || !ready) return null;
    const risk = residentContext && residentContext.residentId === residentId ? residentContext.context : null;
    const context: CareEventContext = {
      active_watch: risk?.active_watch ?? false,
      elopement_risk: risk?.elopement_risk ?? false,
      prior_unexplained_bruise_30d: risk?.prior_unexplained_bruise_30d ?? false,
      location_label: state.locationLabel,
      time_label: timeLabel(occurredAt, ready.ctx.timeZone),
    };
    return deriveCareEvent(state.kind, answersForEngine(state), context);
  }, [state, ready, residentContext, residentId, occurredAt]);

  // Offline queue confirmations carry the server receipt back to this screen.
  useEffect(() => {
    if (!ready) return;
    return subscribeCareEventQueue(
      (queueState) => {
        const mine = queueState.sent.find((entry) => entry.clientEventId === clientEventId);
        if (!mine) return;
        try {
          dispatch({ type: "queue_confirmed", receipt: parseCareEventReceipt(mine.receipt) });
        } catch {
          // The server confirmed it but the receipt was unreadable; the revisit page shows it.
        }
      },
      { ownerUserId: ready.userId },
    );
  }, [ready, clientEventId]);

  const handleSend = useCallback(async () => {
    if (!ready || !derivation || state.submitStatus === "submitting") return;
    const sentAtIso = new Date().toISOString();
    dispatch({ type: "submit_start", sentAtIso });
    const enqueue = async () => {
      const payload = buildSubmitPayload(state, { facilityId: ready.ctx.facilityId, capturedOffline: true });
      await queueCareEvent({
        clientEventId,
        ownerUserId: ready.userId,
        organizationId: ready.ctx.organizationId,
        facilityId: ready.ctx.facilityId,
        payload,
        level: derivation.level,
        queuedAt: sentAtIso,
        retryCount: 0,
        lastError: null,
        terminal: false,
      });
      dispatch({ type: "offline_queued", sentAtIso });
    };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      try {
        await enqueue();
      } catch {
        dispatch({ type: "submit_failure", error: "This device is offline and could not keep the event. Tell the Administrator or Assistant now." });
      }
      return;
    }
    try {
      const receipt = await submitCareEvent(supabase, buildSubmitPayload(state, { facilityId: ready.ctx.facilityId }));
      dispatch({ type: "submit_success", receipt });
    } catch (error) {
      if (isLikelyNetworkError(error)) {
        try {
          await enqueue();
          return;
        } catch {
          // fall through to the failure line
        }
      }
      dispatch({ type: "submit_failure", error: describeSubmitFailure(error) });
    }
  }, [ready, derivation, state, clientEventId, supabase]);

  return { supabase, data, ready, retry, state, dispatch, derivation, handleSend };
}
