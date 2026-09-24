"use client";

import type { ReactNode } from "react";
import { ArrowLeft, Lock, Wifi, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";

import { FloorClock } from "./FloorClock";
import { FLOOR_FOCUS_RING, FLOOR_PRESS } from "./floor-styles";
import { useOnline } from "./useOnline";

/** "Homewood Lodge · HL-FLOOR-02" with the lock icon (DESIGN.md 01, sentence case per §2). */
export function FloorDeviceLine({ facilityName, deviceLabel }: { facilityName: string | null; deviceLabel: string | null }) {
  const text = [facilityName, deviceLabel].filter(Boolean).join(" · ");
  return (
    <span className="flex items-center gap-2.5 text-xs font-medium tracking-wide text-muted-foreground">
      <Lock className="size-4.5" aria-hidden />
      {text || "Floor tablet"}
    </span>
  );
}

export function FloorOnlineState({ syncedWord = "Online" }: { syncedWord?: string }) {
  const online = useOnline();
  const Icon = online ? Wifi : WifiOff;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <Icon className="size-4" aria-hidden />
      {online ? syncedWord : "Offline"}
    </span>
  );
}

/** The 56 px bar on the lock and setup screens: chrome color, hairline under it. */
export function FloorLockBar({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-chrome-primary px-6 text-chrome-foreground">
      {left}
      <span className="flex items-center gap-4.5">
        {right}
        <FloorClock />
      </span>
    </header>
  );
}

export function NotYouButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 items-center gap-2 rounded-[8px] border border-input pl-2 pr-3.5 text-[15px] font-medium text-foreground hover:bg-muted",
        FLOOR_PRESS,
        FLOOR_FOCUS_RING,
      )}
    >
      <ArrowLeft className="size-4.5" aria-hidden />
      Not you
    </button>
  );
}
