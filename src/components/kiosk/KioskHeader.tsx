"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { KIOSK_BACK, KIOSK_HOME_COPY, formatKioskClock, formatKioskDate } from "@/lib/kiosk/screens";
import { cn } from "@/lib/utils";

import { useKiosk, useKioskClock } from "./kiosk-context";

/** Chrome band on every kiosk screen: 128 px on home, 88 px elsewhere (DESIGN §1). */
export function KioskHeader({ title, back = false }: { title?: string; back?: boolean }) {
  const { device, timeZone } = useKiosk();
  const clock = useKioskClock();
  const facility = device?.facilityName ?? "";
  const time = clock ? formatKioskClock(clock, timeZone) : "\u00a0";

  if (!title) {
    return (
      <header className="flex h-32 shrink-0 items-center justify-between gap-6 bg-chrome-primary px-10 text-chrome-foreground">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[15px] text-chrome-foreground-muted">{KIOSK_HOME_COPY.brand}</p>
          <h1 className="truncate text-[36px] font-semibold leading-tight">{facility}</h1>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="text-[40px] font-medium leading-none tabular-nums" data-testid="kiosk-clock">
            {time}
          </p>
          <p className="text-base text-chrome-foreground-muted">{clock ? formatKioskDate(clock, timeZone) : "\u00a0"}</p>
        </div>
      </header>
    );
  }

  return (
    <header className="flex h-22 shrink-0 items-center justify-between gap-6 bg-chrome-primary px-8 text-chrome-foreground">
      <div className="flex min-w-0 items-center gap-5">
        {back ? (
          <Link
            href="/kiosk"
            className={cn(
              "inline-flex h-13 shrink-0 items-center gap-2 rounded-[10px] border border-chrome-foreground/25 pl-3 pr-4.5 text-[17px] font-medium",
              "hover:bg-chrome-foreground/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/60",
            )}
          >
            <ArrowLeft className="size-5" aria-hidden />
            {KIOSK_BACK}
          </Link>
        ) : null}
        <h1 className="truncate text-[26px] font-semibold">{title}</h1>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <p className="text-[22px] font-medium leading-tight tabular-nums" data-testid="kiosk-clock">
          {time}
        </p>
        <p className="text-[13px] text-chrome-foreground-muted">{facility}</p>
      </div>
    </header>
  );
}
