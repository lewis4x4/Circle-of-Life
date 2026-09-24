"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown, Menu } from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { canOpenExecutiveHubHref } from "@/lib/auth/executive-nav-access";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Primary links render in a segmented control. Secondary links live in a
 * "More ▾" dropdown anchored to the right edge of the strip. Mobile collapses
 * everything into a Sheet-driven nav drawer. Total strip height: h-9.
 *
 * This is the one executive strip (COL-655): the CEO / CFO / COO boards,
 * scenarios, entities and settings render it instead of their own tab rows.
 * Stand Up is one entry (COL-707): it opens the weekly form, stays lit on the
 * executive roll-up, history and compare views, and those views are reached
 * from Stand Up's own view strip rather than from More. Executive Reports is
 * retired; its URL 308s to /admin/reports.
 */
const PRIMARY = [
  { href: "/admin/executive", label: "Overview" },
  { href: "/admin/stand-up", label: "Stand Up" },
  { href: "/admin/executive/nlq", label: "Haven Insight" },
] as const;

const SECONDARY = [
  { href: "/admin/executive/ceo", label: "CEO" },
  { href: "/admin/executive/cfo", label: "CFO" },
  { href: "/admin/executive/coo", label: "COO" },
  { href: "/admin/executive/alerts", label: "Alerts" },
  { href: "/admin/executive/league", label: "League" },
  { href: "/admin/executive/benchmarks", label: "Benchmarks" },
  { href: "/admin/executive/scenarios", label: "Scenarios" },
  { href: "/admin/executive/entity", label: "Entities" },
  { href: "/admin/executive/settings", label: "Executive settings" },
] as const;

/** Stand Up destinations shown while auth resolves (every executive-hub role can open them). */
function isStandUpHref(href: string) {
  return href === "/admin/stand-up" || href === "/admin/executive/standup" || href.startsWith("/admin/executive/standup/");
}

function isHrefActive(pathname: string, href: string) {
  if (href === "/admin/executive") return pathname === "/admin/executive";
  // The one Stand Up entry covers the executive roll-up views too.
  if (href === "/admin/stand-up") return isStandUpHref(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ExecutiveHubNav() {
  // V2 routes render under /admin/v2/…; the strip's destinations are the canonical URLs.
  const pathname = (usePathname() ?? "").replace(/^\/admin\/v2(?=\/|$)/, "/admin");
  const { appRole, loading: authLoading } = useHavenAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const primaryItems = useMemo(() => {
    if (authLoading || !appRole) {
      return PRIMARY.filter((item) => isStandUpHref(item.href));
    }
    return PRIMARY.filter((item) => canOpenExecutiveHubHref(appRole, item.href));
  }, [appRole, authLoading]);

  const secondaryItems = useMemo(() => {
    if (authLoading || !appRole) {
      return SECONDARY.filter((item) => isStandUpHref(item.href));
    }
    return SECONDARY.filter((item) => canOpenExecutiveHubHref(appRole, item.href));
  }, [appRole, authLoading]);

  // Choose once across both groups so a child destination wins over its parent.
  const activeHref = useMemo(
    () => [...primaryItems, ...secondaryItems]
      .filter((item) => isHrefActive(pathname, item.href))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href,
    [pathname, primaryItems, secondaryItems],
  );
  const activeSecondary = secondaryItems.find((item) => item.href === activeHref);

  return (
    <>
      {/* Desktop / tablet: segmented control + More dropdown */}
      <nav
        aria-label="Executive intelligence sections"
        className={cn(
          "hidden md:inline-flex h-9 items-center gap-0.5 whitespace-nowrap rounded-lg border border-border bg-muted/50 p-1",
        )}
      >
        {primaryItems.map((item) => {
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              data-state={active ? "active" : "inactive"}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-3 text-[12px] font-medium",
                "transition-colors duration-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}

        {secondaryItems.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md px-3 text-[12px] font-medium",
                "transition-colors duration-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeSecondary
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={
                activeSecondary
                  ? `More views — currently ${activeSecondary.label}`
                  : "More views"
              }
            >
              {activeSecondary ? activeSecondary.label : "More"}
              <ChevronDown className="size-3 opacity-70" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-1">
              {secondaryItems.map((item) => {
                const active = item.href === activeHref;
                return (
                  <DropdownMenuItem
                    key={item.href}
                    className="p-0"
                    nativeButton={false}
                    render={
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-8 w-full cursor-pointer items-center rounded-md px-2 text-[13px]",
                          active
                            ? "bg-secondary font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {item.label}
                      </Link>
                    }
                  />
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </nav>

      {/* Mobile: Sheet-driven drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          className={cn(
            "md:hidden inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[12px] font-medium",
            "text-foreground transition-colors hover:bg-secondary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label="Open executive intelligence sections"
        >
          <Menu className="size-4" aria-hidden />
          Sections
        </SheetTrigger>
        <SheetContent side="right" className="w-[280px] p-0" showCloseButton={false}>
          <SheetHeader className="border-b border-border/60 px-4 py-3">
            <SheetTitle className="text-[14px] font-semibold tracking-tight">
              Executive intelligence
            </SheetTitle>
          </SheetHeader>
          <nav
            aria-label="Executive intelligence sections"
            className="flex flex-col gap-1 p-2"
            onClick={() => setMobileOpen(false)}
          >
            {[...primaryItems, ...secondaryItems].map((item) => {
              const active = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center rounded-md px-2 text-[13px]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
