"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DischargeHubNav() {
  const pathname = usePathname();

  const isPipeline =
    pathname === "/admin/discharge" ||
    (pathname.startsWith("/admin/discharge/") && !pathname.startsWith("/admin/discharge/new"));

  const links = [
    { href: "/admin/discharge", label: "Pipeline", active: isPipeline },
    { href: "/admin/discharge/new", label: "New reconciliation", active: pathname.startsWith("/admin/discharge/new") },
  ] as const;

  return (
    <nav
      className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"
      aria-label="Discharge sections"
    >
      {links.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: item.active ? "default" : "outline", size: "sm" }),
            item.active && item.href === "/admin/discharge" && pathname === "/admin/discharge" && "pointer-events-none",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
