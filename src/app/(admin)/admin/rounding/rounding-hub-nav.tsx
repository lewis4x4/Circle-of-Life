"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  Eye,
  FileBarChart,
  LayoutDashboard,
  Plus,
} from "lucide-react";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin/rounding", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/rounding/live", label: "Live Board", icon: Eye },
  { href: "/admin/rounding/plans", label: "Plans", icon: ClipboardList },
  { href: "/admin/rounding/plans/new", label: "New Plan", icon: Plus },
  { href: "/admin/rounding/reports", label: "Reports", icon: FileBarChart },
] as const;

export function RoundingHubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap gap-1.5 rounded-xl border border-slate-800/60 bg-slate-900/40 backdrop-blur-md p-1.5"
      aria-label="Rounding sections"
    >
      {NAV_ITEMS.map((item) => {
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
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-mono tracking-wide transition-all duration-200",
              active
                ? "bg-white/10 text-slate-100 shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5",
            )}
          >
            <Icon aria-hidden className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
