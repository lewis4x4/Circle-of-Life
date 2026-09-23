"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";

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

import { ReportHowBadStep } from "./ReportHowBadStep";
import { ReportReceipt } from "./ReportReceipt";
import { ReportWhatStep } from "./ReportWhatStep";
import { ReportWhoStep } from "./ReportWhoStep";
import { TapButton } from "./TapButton";
import { useReportFlowData } from "./useReportFlowData";

import { WizardStep, WizardSteps, type WizardStepState } from "@/components/ui/wizard-steps";

const STEP_TITLES = { who: "Who", what: "What", how_bad: "How bad", receipt: "Saved" } as const;

/** The three steps a caregiver walks before the receipt. */
const REPORT_STEPS = ["who", "what", "how_bad"] as const;

type WizardStepId = (typeof REPORT_STEPS)[number];

function stepState(step: WizardStepId, current: WizardStepId): WizardStepState {
  const stepIndex = REPORT_STEPS.indexOf(step);
  const currentIndex = REPORT_STEPS.indexOf(current);
  if (stepIndex < currentIndex) return "complete";
  if (stepIndex === currentIndex) return "current";
  return "upcoming";
}

function timeLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/**
 * The three-tap "Something happened" flow (spec 07A §2, §6.4): Who, What,
 * How bad, then the receipt. The level engine runs on every answer change;
 * the server derives it again and never trusts the client's level.
 */
export function CareEventReportFlow({
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

  if (data.status === "loading") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground" role="status">
        <Loader2 className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
        <p className="text-sm">Loading your residents</p>
      </div>
    );
  }
  if (data.status === "error" || !ready) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <p role="alert" className="rounded-lg border border-border bg-muted/40 px-5 py-4 text-sm text-foreground">
          {data.status === "error" ? data.message : "Something happened could not open."}
        </p>
        <TapButton onClick={retry}>Try again</TapButton>
      </div>
    );
  }

  const canGoBack = state.step === "what" || state.step === "how_bad";
  // Held in a const so the "not the receipt" narrowing survives into the
  // map callback below — reading state.step inside the closure would widen
  // it back to include "receipt".
  const currentStep = state.step;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-8">
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          {canGoBack ? (
            <TapButton className="w-auto flex-none px-4" aria-label="Back" onClick={() => dispatch({ type: "back" })}>
              <ChevronLeft className="size-6" aria-hidden />
            </TapButton>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">Something happened</h1>
            {currentStep === "receipt" ? (
              <p className="text-sm text-muted-foreground">{STEP_TITLES.receipt}</p>
            ) : null}
          </div>
        </div>
        {currentStep === "receipt" ? null : (
          <WizardSteps aria-label="Report progress">
            {REPORT_STEPS.map((step) => (
              <WizardStep key={step} label={STEP_TITLES[step]} state={stepState(step, currentStep)} />
            ))}
          </WizardSteps>
        )}
      </header>

      {state.step === "who" ? (
        <ReportWhoStep
          facilityName={ready.ctx.facilityName}
          myResidents={ready.myResidents}
          everyone={ready.everyone}
          loading={false}
          onPickResident={(resident) => dispatch({ type: "pick_resident", resident })}
          onNoResident={() => dispatch({ type: "no_resident" })}
        />
      ) : null}

      {state.step === "what" ? (
        <ReportWhatStep resident={state.resident} onPickKind={(kind) => dispatch({ type: "pick_kind", kind })} />
      ) : null}

      {state.step === "how_bad" && derivation ? (
        <ReportHowBadStep
          state={state}
          derivation={derivation}
          locationChips={ready.locationChips}
          dispatch={dispatch}
          onSend={() => void handleSend()}
        />
      ) : null}

      {state.step === "receipt" && state.kind && derivation ? (
        <ReportReceipt
          supabase={supabase}
          organizationId={ready.ctx.organizationId}
          facilityId={ready.ctx.facilityId}
          timeZone={ready.ctx.timeZone}
          kind={state.kind}
          level={derivation.level}
          sentence={derivation.sentence}
          resident={state.resident ? { firstName: state.resident.firstName, lastName: state.resident.lastName } : null}
          savedAtIso={state.sentAtIso}
          receipt={state.receipt}
          offline={state.submitStatus === "queued"}
          onCallPhone={ready.onCallPhone}
        />
      ) : null}
    </div>
  );
}
