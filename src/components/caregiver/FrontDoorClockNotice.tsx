import { DoorOpen } from "lucide-react";

import { BackLink } from "@/design-system/components/BackLink";
import { FRONT_DOOR_CLOCK_COPY } from "@/lib/timeclock/front-door-copy";

/** Shown on /caregiver/clock where the facility clocks staff in at the front-door kiosk (spec 40 §1). */
export function FrontDoorClockNotice({ homeHref }: { homeHref: string }) {
  return (
    <div className="mx-auto mt-4 max-w-lg space-y-4 md:mt-10">
      <BackLink label="Shift home" href={homeHref} className="min-h-[44px]" />
      <section
        role="status"
        className="flex flex-col items-center rounded-xl border border-border bg-card p-6 text-center text-card-foreground sm:p-10"
      >
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-lg border border-primary/30 bg-primary/20">
          <DoorOpen className="h-8 w-8 text-primary" aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-3xl font-semibold text-foreground">{FRONT_DOOR_CLOCK_COPY.title}</h1>
        <p className="max-w-xs text-base text-muted-foreground">{FRONT_DOOR_CLOCK_COPY.body}</p>
      </section>
    </div>
  );
}
