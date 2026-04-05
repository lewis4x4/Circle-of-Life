"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/finance", label: "Overview" },
  { href: "/admin/finance/chart-of-accounts", label: "Chart of accounts" },
  { href: "/admin/finance/journal-entries", label: "Journal entries" },
  { href: "/admin/finance/journal-entries/new", label: "New journal" },
  { href: "/admin/finance/ledger", label: "Ledger" },
  { href: "/admin/finance/trial-balance", label: "Trial balance" },
  { href: "/admin/finance/budget", label: "Budget" },
  { href: "/admin/finance/gl-settings", label: "GL settings" },
] as const;

export function FinanceHubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"
      aria-label="Finance sections"
    >
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
