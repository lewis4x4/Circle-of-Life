"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/billing", label: "Overview" },
  { href: "/admin/billing/invoices", label: "Invoices" },
  { href: "/admin/billing/rates", label: "Rates" },
  { href: "/admin/billing/invoices/generate", label: "Generate" },
  { href: "/admin/billing/payments/new", label: "New payment" },
  { href: "/admin/billing/collections", label: "Collections" },
  { href: "/admin/billing/ar-aging", label: "AR aging" },
  { href: "/admin/billing/revenue", label: "Revenue" },
  { href: "/admin/billing/org-ar-aging", label: "Org AR" },
] as const;

export function BillingHubNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70" aria-label="Billing sections">
      {LINKS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
              active && "pointer-events-none",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
