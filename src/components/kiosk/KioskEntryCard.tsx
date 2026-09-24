import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { KIOSK_CARD, KIOSK_FOCUS, KIOSK_ICON_TILE, KIOSK_PRESS } from "./kiosk-styles";

/** One visitor entry on the kiosk home (DESIGN §5, `10-kiosk-home`). */
export function KioskEntryCard({ href, icon: Icon, title, sub }: { href: string; icon: LucideIcon; title: string; sub: string }) {
  return (
    <Link href={href} className={cn(KIOSK_CARD, "flex min-h-32 items-center gap-5 px-7 py-5 text-left hover:bg-muted/40", KIOSK_FOCUS, KIOSK_PRESS)}>
      <span className={cn(KIOSK_ICON_TILE, "size-16 rounded-[14px]")}>
        <Icon className="size-7.5" strokeWidth={2} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="text-2xl font-semibold leading-tight text-foreground">{title}</span>
        <span className="text-base text-muted-foreground">{sub}</span>
      </span>
    </Link>
  );
}
