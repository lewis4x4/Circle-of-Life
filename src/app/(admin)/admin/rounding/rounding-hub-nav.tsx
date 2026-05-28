"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Brain,
  ClipboardList,
  Eye,
  FileBarChart,
  LayoutDashboard,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Sub-tab strip for the Smart Rounding workspace.
 *
 * Quiet Operator rules in play:
 *   - Sentence case labels (no all-caps, no font-mono).
 *   - Inactive tabs render at standard muted-text contrast (WCAG AA).
 *   - Active tab uses segmented control treatment (chrome surface + 1px ring).
 *   - "+ New Plan" lives in the page header as a primary CTA, not in the tab
 *     strip — creation actions are not destinations.
 */
const NAV_ITEMS = [
  { href: "/admin/rounding", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/rounding/live", label: "Live board", icon: Eye },
  { href: "/admin/rounding/plans", label: "Plans", icon: ClipboardList },
  { href: "/admin/rounding/watches", label: "Watches", icon: Shield },
  { href: "/admin/rounding/escalations", label: "Escalations", icon: AlertTriangle },
  { href: "/admin/rounding/integrity", label: "Integrity", icon: ShieldAlert },
  { href: "/admin/rounding/reports", label: "Reports", icon: FileBarChart },
  { href: "/admin/rounding/safety", label: "Safety scores", icon: ShieldCheck },
  { href: "/admin/rounding/insights", label: "Insights", icon: Brain },
] as const;

export function RoundingHubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
      aria-label="Smart Rounding sections"
    >
      {NAV_ITEMS.map((item) => {
        // Overview is only "active" on exact match; nested routes never highlight Overview.
        const active =
          pathname === item.href ||
          (item.href !== "/admin/rounding" && pathname.startsWith(`${item.href}/`));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "bg-muted text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
