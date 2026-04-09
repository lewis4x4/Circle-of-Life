"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
      className="flex flex-wrap gap-1.5 w-fit rounded-full border border-slate-200/50 bg-slate-100/50 p-1.5 shadow-inner dark:border-white/5 dark:bg-black/40 backdrop-blur-3xl"
      aria-label="Reports sections"
    >
      {LINKS.map((item) => {
        const isActive = item.href === "/admin/reports" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition-all outline-none tap-responsive",
              isActive 
                 ? "bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm border border-slate-200/50 dark:border-white/10" 
                 : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-white/5"
            )}
            style={{ pointerEvents: isActive ? "none" : "auto" }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
