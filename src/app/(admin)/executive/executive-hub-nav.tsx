"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/executive", label: "Overview" },
  { href: "/admin/executive/ceo", label: "CEO View" },
  { href: "/admin/executive/cfo", label: "CFO View" },
  { href: "/admin/executive/coo", label: "COO View" },
  { href: "/admin/executive/alerts", label: "Alerts" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/executive/benchmarks", label: "Benchmarks" },
  { href: "/admin/executive/nlq", label: "NLQ" },
] as const;

export function ExecutiveHubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap gap-1.5 rounded-full border border-slate-200/50 bg-slate-100/50 p-1.5 shadow-inner dark:border-white/5 dark:bg-black/40 backdrop-blur-3xl"
      aria-label="Executive Intelligence sections"
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
