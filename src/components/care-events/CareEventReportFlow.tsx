"use client";

import { ChevronLeft, Loader2 } from "lucide-react";

import type { CareEventKind } from "@/lib/care-events/level-engine";

import { ReportHowBadStep } from "./ReportHowBadStep";
import { ReportReceipt } from "./ReportReceipt";
import { ReportWhatStep } from "./ReportWhatStep";
import { ReportWhoStep } from "./ReportWhoStep";
import { TapButton } from "./TapButton";
import { useCareEventReport } from "./useCareEventReport";

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
  const { supabase, data, ready, retry, state, dispatch, derivation, handleSend } = useCareEventReport({
    prefillResidentId,
    prefillKind,
  });

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
