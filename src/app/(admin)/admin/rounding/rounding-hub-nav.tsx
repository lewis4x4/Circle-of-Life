"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Eye, FileBarChart, ShieldAlert, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Sub-tab strip for the Smart Rounding workspace. Spec 25A defect 9.
 *
 * Five tabs, and the reasoning for each collapse is worth keeping next to the
 * list because the nine-tab strip grew one tab at a time:
 *
 *   - Overview folded into the Live board. The board is the landing surface; a
 *     summary of the board is not a second destination.
 *   - Escalations folded into the Live board as a filter. The Quiet Operator
 *     constitution rejects a workflow rendered as a destination tab, and an
 *     escalation is a state a check is in, not a place.
 *   - Plans is gone with the per resident observation plan (defect 7). Cadence
 *     is facility level and inherited; the only per resident record is a
 *     Monitoring Order.
 *   - Watches is gone. A Monitoring Order is the operator model, and the
 *     Monitoring Orders tab is its facility level list.
 *   - Safety scores is gone, replaced by the Watchlist (section 7.1).
 *   - Insights folded into Reports.
 *
 * The Live board is `/admin/rounding` itself. Nothing in this strip is a
 * creation action: entering a Monitoring Order happens on the resident record.
 */
const NAV_ITEMS = [
  { href: "/admin/rounding", label: "Live board", icon: Eye },
  { href: "/admin/rounding/watchlist", label: "Watchlist", icon: ShieldCheck },
  { href: "/admin/rounding/monitoring-orders", label: "Monitoring Orders", icon: ClipboardList },
  { href: "/admin/rounding/integrity", label: "Integrity", icon: ShieldAlert },
  { href: "/admin/rounding/reports", label: "Reports", icon: FileBarChart },
] as const;

export function RoundingHubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
      aria-label="Smart Rounding sections"
    >
      {NAV_ITEMS.map((item) => {
        // The Live board is the hub root, so it only highlights on an exact
        // match. Every other tab also highlights for its nested routes.
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
