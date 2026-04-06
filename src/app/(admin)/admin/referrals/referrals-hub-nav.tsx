"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ReferralsHubNav() {
  const pathname = usePathname();

  const isPipeline =
    pathname === "/admin/referrals" ||
    (pathname.startsWith("/admin/referrals/") &&
      !pathname.startsWith("/admin/referrals/new") &&
      !pathname.startsWith("/admin/referrals/sources") &&
      !pathname.startsWith("/admin/referrals/hl7-inbound"));

  const links = [
    { href: "/admin/referrals", label: "Pipeline", active: isPipeline },
    { href: "/admin/referrals/new", label: "New lead", active: pathname.startsWith("/admin/referrals/new") },
    { href: "/admin/referrals/sources", label: "Sources", active: pathname.startsWith("/admin/referrals/sources") },
    {
      href: "/admin/referrals/hl7-inbound",
      label: "HL7 inbound",
      active: pathname.startsWith("/admin/referrals/hl7-inbound"),
    },
  ] as const;

  return (
    <nav
      className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"
      aria-label="Referral sections"
    >
      {links.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: item.active ? "default" : "outline", size: "sm" }),
            item.active && item.href === "/admin/referrals" && pathname === "/admin/referrals" && "pointer-events-none",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
