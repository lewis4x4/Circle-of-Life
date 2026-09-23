"use client";

import { Loader2 } from "lucide-react";

import { EarlierStepper } from "@/components/care-events/EarlierStepper";
import { LevelBanner } from "@/components/care-events/LevelBanner";
import type { CareEventDerivation } from "@/lib/care-events/level-engine";
import { careEventSendButtonLabel } from "@/lib/care-events/level-copy";
import type { LocationChip } from "@/lib/care-events/report-data";
import { canSend, type ReportAction, type ReportState } from "@/lib/care-events/report-state";
import type { CareEventQuestion } from "@/lib/care-events/tiles";
import { cn } from "@/lib/utils";

import { ChoiceChip, ChoiceGroup } from "./ChoiceChip";
import { FLOOR_PRIMARY_BUTTON } from "./floor-styles";
import { QuestionOption } from "./QuestionOption";

/** One question per screen (DESIGN.md 07): 34/600 question, 640 px column of large answers. */
export function FloorReportQuestion({
  question,
  value,
  onAnswer,
  onToggle,
  onNext,
}: {
  question: CareEventQuestion;
  value: string | string[] | undefined;
  onAnswer: (value: string) => void;
  onToggle: (value: string) => void;
  onNext: () => void;
}) {
  const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 overflow-y-auto px-6 py-8 lg:px-30">
      <h2 id={`question-${question.key}`} className="text-center text-[34px] font-semibold text-foreground">
        {question.prompt}
      </h2>
      <div
        className="flex w-160 max-w-full flex-col gap-3.5"
        role={question.multi ? "group" : "radiogroup"}
        aria-labelledby={`question-${question.key}`}
      >
        {question.options.map((option) => (
          <QuestionOption
            key={option.value}
            multi={question.multi}
            selected={selected.includes(option.value)}
            onPress={() => (question.multi ? onToggle(option.value) : onAnswer(option.value))}
          >
            {option.label}
          </QuestionOption>
        ))}
      </div>
      {question.multi ? (
        <button type="button" onClick={onNext} className={cn(FLOOR_PRIMARY_BUTTON, "h-13 rounded-[10px] px-7 text-base")}>
          Next
        </button>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {question.multi ? "Tap all that apply, then Next. One question at a time." : "Tap an answer to go on. One question at a time."}
      </p>
    </div>
  );
}

/**
 * After the last question: the same read-back, place, "earlier" stepper, "I'm
 * worried" and send button the caregiver flow shows, so the person sees what
 * sending will do before it goes.
 */
export function FloorReportSend({
  state,
  derivation,
  locationChips,
  dispatch,
  onSend,
}: {
  state: ReportState;
  derivation: CareEventDerivation;
  locationChips: readonly LocationChip[];
  dispatch: (action: ReportAction) => void;
  onSend: () => void;
}) {
  if (!state.kind) return null;
  const submitting = state.submitStatus === "submitting";
  const ready = canSend(state);
  const alreadyEmergency = derivation.derived_level === 4;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-6">
      <div className="flex w-160 max-w-full flex-col gap-5">
        <LevelBanner kind={state.kind} derivation={derivation} />
        {locationChips.length > 0 ? (
          <ChoiceGroup id="floor-report-where" title="Where?" hint="optional">
            {locationChips.map((chip) => {
              const pressed = state.locationCode === chip.code;
              return (
                <ChoiceChip
                  key={chip.code}
                  pressed={pressed}
                  onPress={() =>
                    dispatch(pressed ? { type: "set_location", code: null, label: null } : { type: "set_location", code: chip.code, label: chip.label })
                  }
                >
                  {chip.label}
                </ChoiceChip>
              );
            })}
          </ChoiceGroup>
        ) : null}
        <EarlierStepper
          open={state.earlierOpen}
          minutesAgo={state.minutesAgo}
          onToggle={() => dispatch({ type: "toggle_earlier" })}
          onStep={(delta) => dispatch({ type: "step_minutes", delta })}
        />
        <ChoiceChip pressed={state.worried} disabled={alreadyEmergency} onPress={() => dispatch({ type: "toggle_worried" })} className="w-full justify-center">
          {alreadyEmergency ? "Already at Emergency" : "I'm worried, raise it"}
        </ChoiceChip>
        {state.submitError ? (
          <p role="alert" className="rounded-[8px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
            {state.submitError}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onSend}
          disabled={!ready || submitting}
          className={cn(
            FLOOR_PRIMARY_BUTTON,
            "h-16 rounded-[10px] text-lg",
            derivation.level === 4 && "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
          )}
        >
          {submitting ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {submitting ? "Sending" : careEventSendButtonLabel(derivation.level)}
        </button>
        {!ready && !submitting ? <p className="text-center text-sm text-muted-foreground">Answer each question to send.</p> : null}
      </div>
    </div>
  );
}
