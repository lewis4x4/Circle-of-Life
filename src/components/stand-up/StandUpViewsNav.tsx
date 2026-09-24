"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Stand Up is one surface with several views (COL-707): the weekly facility form
 * and the executive roll-up built from it, with history and compare beside them.
 * The executive hub has a single Stand Up entry; this strip moves between the views.
 */
export const STAND_UP_VIEWS = [
  { href: "/admin/stand-up", label: "Facility entry" },
  { href: "/admin/executive/standup", label: "All-buildings roll-up" },
  { href: "/admin/executive/standup/history", label: "History" },
  { href: "/admin/executive/standup/compare", label: "Compare" },
] as const;

export function activeStandUpView(pathname: string): string | undefined {
  return STAND_UP_VIEWS.filter((view) => pathname === view.href || pathname.startsWith(`${view.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/** `current` is the page's own route, so the strip needs no router in tests or print views. */
export function StandUpViewsNav({ current }: { current: string }) {
  const active = activeStandUpView(current);
  return (
    <nav aria-label="Stand Up views" className="flex flex-wrap gap-1 border-b border-border pb-2">
      {STAND_UP_VIEWS.map((view) => (
        <Link
          key={view.href}
          href={view.href}
          aria-current={view.href === active ? "page" : undefined}
          className={cn(
            "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            view.href === active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
