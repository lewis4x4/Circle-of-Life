"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeSectionTabHref } from "@/lib/navigation/section-tabs";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin/referrals", label: "Pipeline" },
  { href: "/admin/referrals/new", label: "New lead" },
  { href: "/admin/referrals/sources", label: "Sources" },
  { href: "/admin/referrals/hl7-inbound", label: "Referral inbox" },
] as const;

/**
 * Referral section tabs. Rendered once by the referrals layout, so they sit in
 * the same place at the same width on every referral page — including the
 * Pipeline, which had none (COL-655). Links, not tab buttons: each one is a
 * page. A lead record ([id]) and the admissions hand-off belong to Pipeline.
 */
export function ReferralsHubNav() {
  const pathname = usePathname();
  const active =
    activeSectionTabHref(pathname, NAV.map((item) => item.href)) ??
    (pathname?.replace(/^\/admin\/v2(?=\/|$)/, "/admin").startsWith("/admin/referrals/") ? "/admin/referrals" : null);

  return (
    <nav aria-label="Referral sections" className="flex w-full flex-wrap gap-1 border-b border-border">
      {NAV.map((item) => {
        const current = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
