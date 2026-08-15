import type { CaregiverRoundsEmptyCopy } from "@/lib/rounding/col-discovery-round-cadence";

type CaregiverRoundsEmptyNoticeProps = {
  copy: CaregiverRoundsEmptyCopy;
  /** Optional adjacent cadence reminder for the scoped facility. */
  cadenceReminder?: string | null;
};

export function CaregiverRoundsEmptyNotice({ copy, cadenceReminder }: CaregiverRoundsEmptyNoticeProps) {
  return (
    <div className="space-y-3">
      <section
        aria-label="Rounding queue status"
        className="rounded-lg border border-dashed border-border bg-muted/20 p-4"
        role="status"
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{copy.why}</span>
          {" — "}
          {copy.guidance}
        </p>
      </section>
      {cadenceReminder ? (
        <section
          aria-label="Jessica discovery cadence reminder"
          className="rounded-lg border border-border bg-card px-4 py-3"
        >
          <p className="text-[13px] leading-relaxed text-muted-foreground">{cadenceReminder}</p>
        </section>
      ) : null}
    </div>
  );
}
