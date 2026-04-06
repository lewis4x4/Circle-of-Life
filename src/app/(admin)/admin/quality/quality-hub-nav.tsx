"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function QualityHubNav() {
  const pathname = usePathname();

  const isHub =
    pathname === "/admin/quality" ||
    (pathname.startsWith("/admin/quality/") && !pathname.startsWith("/admin/quality/measures/new"));

  const links = [
    { href: "/admin/quality", label: "Overview", active: isHub },
    { href: "/admin/quality/measures/new", label: "Define measure", active: pathname.startsWith("/admin/quality/measures/new") },
  ] as const;

  return (
    <nav
      className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"
      aria-label="Quality sections"
    >
      {links.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: item.active ? "default" : "outline", size: "sm" }),
            item.active && item.href === "/admin/quality" && pathname === "/admin/quality" && "pointer-events-none",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
