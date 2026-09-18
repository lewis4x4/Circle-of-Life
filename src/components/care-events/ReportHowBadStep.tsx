"use client";

import { Loader2 } from "lucide-react";

import type { CareEventDerivation } from "@/lib/care-events/level-engine";
import { careEventSendButtonLabel } from "@/lib/care-events/level-copy";
import { kindSupportsPrefill } from "@/lib/care-events/prefill";
import type { LocationChip } from "@/lib/care-events/report-data";
import { canSend, type ReportAction, type ReportState } from "@/lib/care-events/report-state";
import { careEventTileByKind, type CareEventQuestion } from "@/lib/care-events/tiles";
import { cn } from "@/lib/utils";

import { EarlierStepper } from "./EarlierStepper";
import { LevelBanner } from "./LevelBanner";
import { TapButton } from "./TapButton";
import { VoicePrefillButton } from "./VoicePrefillButton";

const SEND_TONE: Record<1 | 2 | 3 | 4, "neutral" | "primary" | "destructive"> = {
  1: "primary",
  2: "primary",
  3: "primary",
  4: "destructive",
};

function QuestionRow({
  question,
  value,
  onSingle,
  onMulti,
}: {
  question: CareEventQuestion;
  value: string | string[] | undefined;
  onSingle: (key: string, value: string) => void;
  onMulti: (key: string, value: string) => void;
}) {
  const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-lg font-semibold text-foreground">
        {question.prompt}
        {question.multi ? <span className="ml-2 text-sm font-normal text-muted-foreground">Tap all that apply</span> : null}
      </legend>
      <div className="flex flex-col gap-2" role={question.multi ? "group" : "radiogroup"} aria-label={question.prompt}>
        {question.options.map((option) => {
          const isSelected = selected.includes(option.value);
          return question.multi ? (
            <TapButton
              key={option.value}
              tone={isSelected ? "selected" : "neutral"}
              aria-pressed={isSelected}
              onClick={() => onMulti(question.key, option.value)}
            >
              {option.label}
            </TapButton>
          ) : (
            <TapButton
              key={option.value}
              role="radio"
              tone={isSelected ? "selected" : "neutral"}
              aria-checked={isSelected}
              onClick={() => onSingle(question.key, option.value)}
            >
              {option.label}
            </TapButton>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Tap 3: How bad (spec 07A §2, §2.1). One question row per line, six location
 * chips, the earlier stepper, the live banner, "I'm worried", and the send
 * button whose label already says what will happen. Zero required text.
 */
export function ReportHowBadStep({
  state,
  derivation,
  locationChips,
  dispatch,
  onSend,
}: {
  state: ReportState;
  derivation: CareEventDerivation;
  locationChips: LocationChip[];
  dispatch: (action: ReportAction) => void;
  onSend: () => void;
}) {
  if (!state.kind) return null;
  const tile = careEventTileByKind(state.kind);
  const ready = canSend(state);
  const submitting = state.submitStatus === "submitting";
  // Level 4 before the reporter bump: nothing left to raise.
  const alreadyEmergency = derivation.derived_level === 4;

  return (
    <section className="space-y-6" aria-labelledby="report-how-bad-heading">
      <div>
        <h2 id="report-how-bad-heading" className="text-2xl font-semibold text-foreground">
          {tile.word}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.resident ? `${state.resident.displayName}, ${state.resident.roomLabel}.` : "The building."} Tap the answers that fit.
        </p>
      </div>

      {kindSupportsPrefill(state.kind) ? (
        <VoicePrefillButton
          kind={state.kind}
          onPrefill={(prefill, questionsVersion) =>
            dispatch({ type: "apply_prefill", prefill, questionsVersion })
          }
        />
      ) : null}

      {tile.questions.map((question) => (
        <QuestionRow
          key={question.key}
          question={question}
          value={state.answers[question.key]}
          onSingle={(key, value) => dispatch({ type: "set_answer", key, value })}
          onMulti={(key, value) => dispatch({ type: "toggle_answer", key, value })}
        />
      ))}

      {locationChips.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-lg font-semibold text-foreground">
            Where? <span className="ml-2 text-sm font-normal text-muted-foreground">Optional</span>
          </legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Where it happened">
            {locationChips.map((chip) => {
              const isSelected = state.locationCode === chip.code;
              return (
                <TapButton
                  key={chip.code}
                  role="radio"
                  tone={isSelected ? "selected" : "neutral"}
                  aria-checked={isSelected}
                  onClick={() =>
                    dispatch(
                      isSelected
                        ? { type: "set_location", code: null, label: null }
                        : { type: "set_location", code: chip.code, label: chip.label },
                    )
                  }
                >
                  {chip.label}
                </TapButton>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <EarlierStepper
        open={state.earlierOpen}
        minutesAgo={state.minutesAgo}
        onToggle={() => dispatch({ type: "toggle_earlier" })}
        onStep={(delta) => dispatch({ type: "step_minutes", delta })}
      />

      <LevelBanner kind={state.kind} derivation={derivation} />

      <TapButton
        tone={state.worried ? "selected" : "neutral"}
        aria-pressed={state.worried}
        disabled={alreadyEmergency}
        onClick={() => dispatch({ type: "toggle_worried" })}
      >
        {alreadyEmergency ? "Already at Emergency" : "I'm worried, raise it"}
      </TapButton>

      {state.submitError ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
          {state.submitError}
        </p>
      ) : null}

      <TapButton
        tall
        tone={SEND_TONE[derivation.level]}
        disabled={!ready}
        aria-disabled={!ready || undefined}
        onClick={onSend}
        className={cn("text-lg", submitting && "opacity-80")}
      >
        {submitting ? <Loader2 className="mr-2 size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {submitting ? "Sending" : careEventSendButtonLabel(derivation.level)}
      </TapButton>
      {!ready && !submitting ? (
        <p className="text-center text-sm text-muted-foreground">Answer each question above to send.</p>
      ) : null}
    </section>
  );
}
