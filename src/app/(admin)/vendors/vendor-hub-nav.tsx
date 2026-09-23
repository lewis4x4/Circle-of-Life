"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { activeSectionTabHref } from "@/lib/navigation/section-tabs";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/vendors", label: "Overview" },
  { href: "/admin/vendors/directory", label: "Directory" },
  { href: "/admin/vendors/contracts", label: "Contracts" },
  { href: "/admin/vendors/purchase-orders", label: "Purchase orders" },
  { href: "/admin/vendors/purchase-orders/new", label: "New PO" },
  { href: "/admin/vendors/invoices", label: "Invoices" },
  { href: "/admin/vendors/payments", label: "Payments" },
  { href: "/admin/vendors/spend", label: "Spend" },
] as const;

export function VendorHubNav() {
  const pathname = usePathname();
  const activeHref = activeSectionTabHref(pathname, LINKS.map((item) => item.href));

  return (
    <nav
      className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"
      aria-label="Vendor sections"
    >
      {LINKS.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
              active && "pointer-events-none",
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
