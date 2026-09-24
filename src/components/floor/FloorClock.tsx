"use client";

import { useEffect, useState } from "react";

import { DEFAULT_DISPLAY_TIME_ZONE, formatDisplayTime } from "@/lib/format/datetime";
import { cn } from "@/lib/utils";

/** Re-renders on each minute; null until mounted so the server and client agree. */
export function useFloorNow(intervalMs = 15_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The live time in the top bar, "9:40 AM", in the facility's zone. */
export function FloorClock({ timeZone, className }: { timeZone?: string | null; className?: string }) {
  const now = useFloorNow();
  return (
    <time
      dateTime={now?.toISOString()}
      className={cn("text-[15px] font-medium tabular-nums text-foreground", className)}
      suppressHydrationWarning
    >
      {now ? formatDisplayTime(now, { timeZone: timeZone ?? DEFAULT_DISPLAY_TIME_ZONE }) : ""}
    </time>
  );
}
