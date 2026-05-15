"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/executive", label: "Overview" },
  { href: "/admin/executive/standup", label: "Standup" },
  { href: "/admin/executive/standup/history", label: "History" },
  { href: "/admin/executive/standup/compare", label: "Compare" },
  { href: "/admin/executive/ceo", label: "CEO" },
  { href: "/admin/executive/cfo", label: "CFO" },
  { href: "/admin/executive/coo", label: "COO" },
  { href: "/admin/executive/alerts", label: "Alerts" },
  { href: "/admin/executive/league", label: "League" },
  { href: "/admin/executive/reports", label: "Reports" },
  { href: "/admin/executive/benchmarks", label: "Benchmarks" },
  { href: "/admin/executive/nlq", label: "Insight" },
] as const;

/**
 * Segmented-control style hub navigation, styled to match shadcn TabsList
 * (data-state=active on the active item via aria-current). Renders a row of
 * links rather than tab triggers because each section is a separate route.
 */
export function ExecutiveHubNav() {
  const pathname = usePathname();

  return (
    <nav
      role="tablist"
      aria-label="Executive Intelligence sections"
      className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-1"
    >
      {LINKS.map((item) => {
        const isActive =
          item.href === "/admin/executive"
            ? pathname === "/admin/executive"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "page" : undefined}
            tabIndex={isActive ? 0 : -1}
            className={cn(
              "inline-flex h-7 items-center rounded-md px-3 text-[12px] font-medium",
              "transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-background text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
