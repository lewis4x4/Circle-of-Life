"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/executive", label: "Overview" },
  { href: "/admin/executive/entity", label: "Entities" },
  { href: "/admin/executive/alerts", label: "Alerts" },
  { href: "/admin/executive/settings", label: "Settings" },
] as const;

export function ExecutiveHubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"
      aria-label="Executive Intelligence sections"
    >
      {LINKS.map((item) => {
        const isActive =
          item.href === "/admin/executive"
            ? pathname === "/admin/executive"
            : item.href === "/admin/executive/entity"
              ? pathname === "/admin/executive/entity" ||
                pathname.startsWith("/admin/executive/entity/") ||
                pathname.startsWith("/admin/executive/facility/")
              : pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              buttonVariants({ variant: isActive ? "default" : "outline", size: "sm" }),
              isActive && "pointer-events-none",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
