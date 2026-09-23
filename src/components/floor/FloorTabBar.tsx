"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, ClipboardCheck, List, TriangleAlert, Users, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { FLOOR_FOCUS_RING } from "./floor-styles";

export type FloorTabKey = "now" | "rounds" | "residents" | "report" | "handoff";

export const FLOOR_TABS: ReadonlyArray<{ key: FloorTabKey; label: string; href: string; icon: LucideIcon }> = [
  { key: "now", label: "Now", href: "/floor", icon: List },
  { key: "rounds", label: "Rounds", href: "/floor/rounds", icon: ClipboardCheck },
  { key: "residents", label: "Residents", href: "/floor/residents", icon: Users },
  { key: "report", label: "Report", href: "/floor/report", icon: TriangleAlert },
  { key: "handoff", label: "Handoff", href: "/floor/handoff", icon: ArrowLeftRight },
];

/** Which tab a floor path belongs to. Charting a check is part of Now (DESIGN.md 05). */
export function activeFloorTab(pathname: string): FloorTabKey {
  if (pathname.startsWith("/floor/rounds")) return "rounds";
  if (pathname.startsWith("/floor/residents")) return "residents";
  if (pathname.startsWith("/floor/report")) return "report";
  if (pathname.startsWith("/floor/handoff")) return "handoff";
  return "now";
}

/** The 72 px tab bar; the active tab carries a 2 px top edge in the primary color. */
export function FloorTabBar() {
  const pathname = usePathname() ?? "/floor";
  const active = activeFloorTab(pathname);
  return (
    <nav aria-label="Floor app" className="flex h-18 shrink-0 border-t border-border bg-chrome-primary">
      {FLOOR_TABS.map((tab) => {
        const isActive = tab.key === active;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-full flex-1 basis-0 flex-col items-center justify-center gap-1.5 border-t-2 text-xs",
              isActive
                ? "border-primary font-semibold text-chrome-foreground"
                : "border-transparent font-medium text-chrome-foreground-muted hover:text-chrome-foreground",
              FLOOR_FOCUS_RING,
            )}
          >
            <Icon className="size-5.5" aria-hidden />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
