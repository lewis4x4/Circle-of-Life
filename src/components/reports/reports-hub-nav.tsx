"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/reports", label: "Overview" },
  { href: "/admin/reports/templates", label: "Templates" },
  { href: "/admin/reports/saved", label: "Saved" },
  { href: "/admin/reports/scheduled", label: "Scheduled" },
  { href: "/admin/reports/packs", label: "Packs" },
  { href: "/admin/reports/history", label: "History" },
  { href: "/admin/reports/admin", label: "Governance" },
  { href: "/admin/reports/benchmarks", label: "Benchmarks" },
  { href: "/admin/reports/nlq", label: "NLQ" },
] as const;

export function ReportsHubNav() {
  const pathname = usePathname();
  return (
    <nav
      className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"
      aria-label="Reports sections"
    >
      {LINKS.map((item) => {
        const active = item.href === "/admin/reports" ? pathname === item.href : pathname.startsWith(item.href);
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
