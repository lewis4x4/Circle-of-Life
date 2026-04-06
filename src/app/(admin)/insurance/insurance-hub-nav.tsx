"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/insurance", label: "Overview" },
  { href: "/admin/insurance/policies", label: "Policies" },
  { href: "/admin/insurance/policies/new", label: "New policy" },
  { href: "/admin/insurance/renewals", label: "Renewals" },
  { href: "/admin/insurance/renewal-packages", label: "Renewal packages" },
  { href: "/admin/insurance/claims", label: "Claims" },
  { href: "/admin/insurance/loss-runs", label: "Loss runs" },
  { href: "/admin/insurance/coi", label: "Certificates (COI)" },
  { href: "/admin/insurance/workers-comp", label: "Workers’ comp" },
] as const;

export function InsuranceHubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"
      aria-label="Insurance sections"
    >
      {LINKS.map((item) => {
        const active = pathname === item.href;
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
