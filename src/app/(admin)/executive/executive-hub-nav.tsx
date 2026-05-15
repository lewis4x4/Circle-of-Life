"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown, Menu } from "lucide-react";
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
 * Primary tabs render in a segmented control. Secondary tabs live in a
 * "More ▾" dropdown anchored to the right edge of the strip. Mobile collapses
 * everything into a Sheet-driven nav drawer. Total strip height: h-9.
 */
const PRIMARY = [
  { href: "/admin/executive", label: "Overview" },
  { href: "/admin/executive/standup", label: "Standup" },
  { href: "/admin/executive/reports", label: "Reports" },
  { href: "/admin/executive/nlq", label: "Insight" },
] as const;

const SECONDARY = [
  { href: "/admin/executive/ceo", label: "CEO" },
  { href: "/admin/executive/cfo", label: "CFO" },
  { href: "/admin/executive/coo", label: "COO" },
  { href: "/admin/executive/alerts", label: "Alerts" },
  { href: "/admin/executive/league", label: "League" },
  { href: "/admin/executive/standup/history", label: "Standup history" },
  { href: "/admin/executive/standup/compare", label: "Standup compare" },
  { href: "/admin/executive/benchmarks", label: "Benchmarks" },
] as const;

function isPrimaryHrefActive(pathname: string, href: string) {
  if (href === "/admin/executive") return pathname === "/admin/executive";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isSecondaryHrefActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ExecutiveHubNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeSecondary = useMemo(
    () => SECONDARY.find((item) => isSecondaryHrefActive(pathname, item.href)),
    [pathname],
  );

  return (
    <>
      {/* Desktop / tablet: segmented control + More dropdown */}
      <nav
        role="tablist"
        aria-label="Executive intelligence sections"
        className={cn(
          "hidden md:inline-flex h-9 items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-1",
        )}
      >
        {PRIMARY.map((item) => {
          const active = isPrimaryHrefActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              tabIndex={active ? 0 : -1}
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
            {SECONDARY.map((item) => {
              const active = isSecondaryHrefActive(pathname, item.href);
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
            {[...PRIMARY, ...SECONDARY].map((item) => {
              const active = isPrimaryHrefActive(pathname, item.href);
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
