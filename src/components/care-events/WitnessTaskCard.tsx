"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { VoiceNoteButton } from "@/components/care-events/admin/VoiceNoteButton";
import { TapButton } from "@/components/care-events/TapButton";
import {
  WITNESS_CHOICES,
  completeWitnessTask,
  describeWitnessError,
  type WitnessChoice,
  type WitnessTask,
} from "@/lib/care-events/witness";
import { createClient } from "@/lib/supabase/client";
import { useMemo } from "react";

export type WitnessTaskCardProps = {
  task: WitnessTask;
  /** Called once the statement is on file so the list can drop the card. */
  onCompleted: (followupId: string) => void;
};

/**
 * One witness statement, answered with one tap (spec 07A §5, COL's paper form
 * Section 3). Three choices, 56 px each, and an optional voice note. Nothing
 * here requires typing.
 */
export function WitnessTaskCard({ task, onCompleted }: WitnessTaskCardProps) {
  const supabase = useMemo(() => createClient(), []);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<WitnessChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(choice: WitnessChoice) {
    setError(null);
    setBusy(choice);
    try {
      await completeWitnessTask(supabase, { followupId: task.id, choice, note });
      onCompleted(task.id);
    } catch (caught) {
      setError(describeWitnessError(caught));
      setBusy(null);
    }
  }

  const heading = task.incidentNumber ? `Witness statement for ${task.incidentNumber}` : "Witness statement";

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)] ring-1 ring-border/60">
      <h3 className="text-base font-semibold text-foreground">{heading}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        You were on shift when this happened. Tap what is true for you. Nothing to write.
      </p>

      <div
        role="group"
        aria-label={heading}
        className="mt-4 space-y-2"
      >
        {WITNESS_CHOICES.map((choice) => (
          <TapButton
            key={choice.value}
            tone="neutral"
            disabled={busy !== null}
            onClick={() => void answer(choice.value)}
            className="flex-col items-start justify-center gap-0.5"
          >
            <span className="flex w-full items-center justify-between gap-3">
              <span className="font-medium">{choice.label}</span>
              {busy === choice.value ? (
                <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : null}
            </span>
            <span className="text-sm font-normal text-muted-foreground">{choice.hint}</span>
          </TapButton>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        <VoiceNoteButton label="Add a voice note" onTranscript={setNote} disabled={busy !== null} />
        {note ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
            <span className="text-muted-foreground">Voice note: </span>
            {note}
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
