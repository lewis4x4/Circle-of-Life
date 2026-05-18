"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** Destination tabs only — workflows live in Billing overview header actions. */
const DEST_LINKS = [
  { href: "/admin/billing", label: "Overview" },
  { href: "/admin/billing/invoices", label: "Invoices" },
  { href: "/admin/billing/ar-aging", label: "AR aging" },
  { href: "/admin/billing/rates", label: "Rate library" },
  { href: "/admin/billing/revenue", label: "Revenue" },
  { href: "/admin/billing/org-ar-aging", label: "Per-facility AR" },
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
              "relative rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
              active
                ? "bg-secondary text-foreground shadow-sm ring-1 ring-primary/25 after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:rounded-full after:bg-primary"
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
