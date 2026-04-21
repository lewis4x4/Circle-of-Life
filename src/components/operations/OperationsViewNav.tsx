"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/operations", label: "Today" },
  { href: "/admin/operations/week", label: "Week" },
  { href: "/admin/operations/month", label: "Month" },
  { href: "/admin/operations/quarter", label: "Quarter" },
  { href: "/admin/operations/year", label: "Year" },
  { href: "/admin/operations/calendar", label: "Calendar" },
  { href: "/admin/operations/assets", label: "Assets" },
  { href: "/admin/operations/vendors", label: "Vendors" },
  { href: "/admin/operations/overdue", label: "Overdue" },
  { href: "/admin/operations/missed", label: "Missed" },
] as const;

export function OperationsViewNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-2">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-emerald-400 bg-emerald-100 text-emerald-900"
                : "border-slate-200 bg-background text-muted-foreground hover:border-slate-300 hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
