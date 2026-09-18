"use client";

/**
 * The two notices every Smart Rounding surface needs, in their constitution
 * shapes, so no tab reinvents them.
 *
 * Empty states are left aligned, two lines, and say what would populate them.
 * No centered halo icon and no dashed box: the constitution rejects both, and a
 * dashed box around "nothing here yet" reads as an error the operator caused.
 *
 * The error notice takes a sentence an operator can act on. The diagnosis goes
 * to the console through `logRoundingQueryFailure`, never onto the screen:
 * decision D23's lesson is that error copy which replaces the diagnosis is how
 * three unrelated query defects hid behind one sentence for long enough that a
 * spec was written blaming a fourth cause.
 */

import { Button } from "@/components/ui/button";

export type RoundingNoticeCopy = { why: string; guidance: string };

export function RoundingEmptyNotice({
  label,
  copy,
}: {
  label: string;
  copy: RoundingNoticeCopy;
}) {
  return (
    <section
      aria-label={label}
      role="status"
      className="rounded-lg border border-border bg-card px-4 py-4"
    >
      <p className="text-[13px] font-medium text-foreground">{copy.why}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{copy.guidance}</p>
    </section>
  );
}

export function RoundingErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-[13px] leading-relaxed text-foreground">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
