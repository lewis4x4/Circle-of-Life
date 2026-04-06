"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AdmissionsHubNav() {
  const pathname = usePathname();

  const isPipeline =
    pathname === "/admin/admissions" ||
    (pathname.startsWith("/admin/admissions/") && !pathname.startsWith("/admin/admissions/new"));

  const links = [
    { href: "/admin/admissions", label: "Pipeline", active: isPipeline },
    { href: "/admin/admissions/new", label: "New case", active: pathname.startsWith("/admin/admissions/new") },
  ] as const;

  return (
    <nav
      className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"
      aria-label="Admissions sections"
    >
      {links.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: item.active ? "default" : "outline", size: "sm" }),
            item.active && item.href === "/admin/admissions" && pathname === "/admin/admissions" && "pointer-events-none",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
