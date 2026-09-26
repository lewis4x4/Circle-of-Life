"use client";

import Link from "next/link";
import { Activity, Clock, LogOut, Shield, Truck, User, type LucideIcon } from "lucide-react";

import { KIOSK_KINDS, KIOSK_VISITOR_COPY, KIOSK_VISITOR_KINDS, type KioskVisitorKind } from "@/lib/kiosk/contract";
import { KIOSK_HOME_COPY } from "@/lib/kiosk/screens";
import { cn } from "@/lib/utils";

import { KioskEntryCard } from "./KioskEntryCard";
import { KioskHeader } from "./KioskHeader";
import { KIOSK_CARD, KIOSK_FOCUS, KIOSK_PRESS } from "./kiosk-styles";

const ICONS: Record<KioskVisitorKind, LucideIcon> = { visitor: User, provider: Activity, vendor: Truck, inspector: Shield };

/** Kiosk home (`10-kiosk-home`): who are you, one tap each. */
export function KioskHome() {
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <KioskHeader />
      <div className="flex flex-1 flex-col gap-5.5 px-10 pb-6 pt-7">
        <h2 className="text-[30px] font-semibold text-foreground">{KIOSK_HOME_COPY.welcome}</h2>
        <nav aria-label="Who are you" className="flex min-h-0 flex-1 flex-col gap-5 min-[1000px]:flex-row">
          <Link
            href="/kiosk/staff"
            className={cn(
              "flex min-h-44 shrink-0 flex-col justify-between gap-6 rounded-[16px] bg-chrome-primary p-7.5 text-chrome-foreground hover:bg-chrome-primary/90 min-[1000px]:w-82.5",
              KIOSK_FOCUS,
              KIOSK_PRESS,
            )}
          >
            <Clock className="size-12" strokeWidth={1.8} aria-hidden />
            <span className="flex flex-col gap-2">
              <span className="text-[34px] font-semibold leading-tight">{KIOSK_HOME_COPY.staffTitle}</span>
              <span className="text-lg text-chrome-foreground-muted">{KIOSK_HOME_COPY.staffSub}</span>
            </span>
          </Link>
          <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-5">
            {KIOSK_VISITOR_KINDS.map((kind) => (
              <KioskEntryCard key={kind} href={`/kiosk/sign-in/${kind}`} icon={ICONS[kind]} title={KIOSK_KINDS[kind].title} sub={KIOSK_KINDS[kind].subtitle} />
            ))}
          </div>
        </nav>
        <Link
          href="/kiosk/leaving"
          className={cn(KIOSK_CARD, "flex min-h-32 shrink-0 items-center justify-center gap-4 text-[26px] font-semibold text-foreground hover:bg-muted/40", KIOSK_FOCUS, KIOSK_PRESS)}
        >
          <LogOut className="size-7.5" strokeWidth={2} aria-hidden />
          {KIOSK_VISITOR_COPY.signOutPrompt}
        </Link>
      </div>
    </main>
  );
}
