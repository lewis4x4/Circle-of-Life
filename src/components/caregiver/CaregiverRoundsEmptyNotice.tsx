import type { CaregiverRoundsEmptyCopy } from "@/lib/rounding/caregiver-rounds-copy";

type CaregiverRoundsEmptyNoticeProps = {
  copy: CaregiverRoundsEmptyCopy;
};

/**
 * The caregiver queue's empty state. Two lines, left aligned, and it says what
 * would fill the queue.
 *
 * The cadence reminder that used to sit beside it is gone. It named a person,
 * it read the cadence off a hardcoded list keyed by facility name, and a
 * caregiver with nothing in their queue does not need to be told the times:
 * they need to be told who to ask.
 */
export function CaregiverRoundsEmptyNotice({ copy }: CaregiverRoundsEmptyNoticeProps) {
  return (
    <section
      aria-label="Rounding queue status"
      className="rounded-lg border border-border bg-card px-4 py-4"
      role="status"
    >
      <p className="text-sm font-medium text-foreground">{copy.why}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.guidance}</p>
    </section>
  );
}
