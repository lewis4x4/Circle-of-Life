"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** Destination tabs only — workflows live in Billing overview header actions. */
const DEST_LINKS = [
  { href: "/admin/billing", label: "Overview" },
  { href: "/admin/billing/invoices", label: "Invoices" },
  { href: "/admin/billing/ar-aging", label: "AR aging" },
  { href: "/admin/billing/rates", label: "Rates" },
  { href: "/admin/billing/revenue", label: "Revenue" },
  { href: "/admin/billing/org-ar-aging", label: "Org AR" },
] as const;

export function BillingHubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-2 shadow-[var(--shadow-card)] ring-1 ring-border/60"
      aria-label="Billing sections"
    >
      {DEST_LINKS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
              active
                ? "bg-secondary text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
