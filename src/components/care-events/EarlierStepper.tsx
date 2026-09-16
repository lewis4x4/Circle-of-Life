"use client";

import { Minus, Plus } from "lucide-react";

import { EARLIER_MAX_MINUTES, EARLIER_STEP_MINUTES, formatMinutesAgo } from "@/lib/care-events/report-state";

import { TapButton } from "./TapButton";

/**
 * "It happened earlier" 15-minute stepper (spec 07A §2). Never a datetime picker.
 */
export function EarlierStepper({
  open,
  minutesAgo,
  onToggle,
  onStep,
}: {
  open: boolean;
  minutesAgo: number;
  onToggle: () => void;
  onStep: (delta: number) => void;
}) {
  return (
    <div className="space-y-3">
      <TapButton tone={open ? "selected" : "neutral"} aria-pressed={open} onClick={onToggle}>
        {open ? "It happened earlier (tap to use now)" : "It happened earlier"}
      </TapButton>
      {open ? (
        <div className="flex items-stretch gap-3" role="group" aria-label="How long ago it happened">
          <TapButton
            className="w-auto flex-none px-5"
            aria-label="Earlier by 15 minutes"
            onClick={() => onStep(EARLIER_STEP_MINUTES)}
            disabled={minutesAgo >= EARLIER_MAX_MINUTES}
          >
            <Plus className="size-6" aria-hidden />
          </TapButton>
          <p
            role="status"
            aria-live="polite"
            className="flex min-h-14 flex-1 items-center justify-center rounded-lg border border-border bg-muted/40 px-3 text-center text-lg font-semibold text-foreground"
          >
            {formatMinutesAgo(minutesAgo)}
          </p>
          <TapButton
            className="w-auto flex-none px-5"
            aria-label="Later by 15 minutes"
            onClick={() => onStep(-EARLIER_STEP_MINUTES)}
            disabled={minutesAgo <= 0}
          >
            <Minus className="size-6" aria-hidden />
          </TapButton>
        </div>
      ) : null}
    </div>
  );
}
