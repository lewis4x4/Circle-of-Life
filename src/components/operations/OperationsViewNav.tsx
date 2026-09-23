"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { canAuthorOperationsTemplates } from "@/lib/operations/constants";
import { cn } from "@/lib/utils";

type OperationsNavLink = {
  href: string;
  label: string;
  authorOnly?: boolean;
};

const LINKS: readonly OperationsNavLink[] = [
  { href: "/admin/benefits", label: "Medicaid & Benefits" },
  { href: "/admin/operations", label: "Today" },
  { href: "/admin/operations/week", label: "Week" },
  { href: "/admin/operations/month", label: "Month" },
  { href: "/admin/operations/quarter", label: "Quarter" },
  { href: "/admin/operations/year", label: "Year" },
  { href: "/admin/operations/calendar", label: "Calendar" },
  { href: "/admin/operations/history", label: "Activity history" },
  { href: "/admin/operations/profile", label: "Facility profile" },
  { href: "/admin/operations/attention", label: "Needs attention" },
  { href: "/admin/operations/pager", label: "Pager" },
  { href: "/admin/operations/assets", label: "Assets" },
  { href: "/admin/operations/vendors", label: "Vendors" },
  { href: "/admin/operations/templates", label: "Templates", authorOnly: true },
  { href: "/admin/operations/overdue", label: "Overdue" },
  { href: "/admin/operations/missed", label: "Missed" },
];

export function OperationsViewNav() {
  const pathname = usePathname();
  const { appRole } = useHavenAuth();

  return (
    // One swipeable row on a phone — 16 wrapped chips filled the first screen
    // (COL-657); they wrap from sm up.
    <HorizontalScroll label="Operations views">
      <nav aria-label="Operations views" className="flex gap-2 pb-1 sm:flex-wrap sm:pb-0 [&>*]:shrink-0 [&>*]:whitespace-nowrap">
      {LINKS.filter((link) => !link.authorOnly || canAuthorOperationsTemplates(appRole)).map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
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
      </nav>
    </HorizontalScroll>
  );
}
