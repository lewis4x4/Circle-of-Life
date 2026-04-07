"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RoundingHubNav() {
  const pathname = usePathname();
  const links = [
    { href: "/admin/rounding", label: "Overview" },
    { href: "/admin/rounding/live", label: "Live board" },
    { href: "/admin/rounding/plans", label: "Plans" },
    { href: "/admin/rounding/plans/new", label: "New plan" },
    { href: "/admin/rounding/reports", label: "Reports" },
  ] as const;

  return (
    <nav
      className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"
      aria-label="Rounding sections"
    >
      {links.map((item) => {
        const active = pathname === item.href || (item.href !== "/admin/rounding" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }))}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
