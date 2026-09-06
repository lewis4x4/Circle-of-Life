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

const PRIMARY = [
  { href: "/admin/reports", label: "Overview" },
  { href: "/admin/reports/templates", label: "Templates" },
  { href: "/admin/reports/scheduled", label: "Scheduled" },
  { href: "/admin/reports/packs", label: "Packs" },
  { href: "/admin/reports/history", label: "History" },
] as const;

const SECONDARY = [
  { href: "/admin/reports/saved", label: "Saved" },
  { href: "/admin/reports/admin", label: "Governance" },
  { href: "/admin/reports/benchmarks", label: "Benchmarks" },
  { href: "/admin/reports/nlq", label: "Find a report" },
] as const;

function overviewActive(pathname: string) {
  return pathname === "/admin/reports" || pathname === "/admin/reports/";
}

function templatesActive(pathname: string) {
  return pathname === "/admin/reports/templates" || pathname.startsWith("/admin/reports/templates/");
}

function scheduledActive(pathname: string) {
  return pathname === "/admin/reports/scheduled" || pathname.startsWith("/admin/reports/scheduled/");
}

function packsActive(pathname: string) {
  return pathname === "/admin/reports/packs" || pathname.startsWith("/admin/reports/packs/");
}

function historyActive(pathname: string) {
  return (
    pathname === "/admin/reports/history" ||
    pathname.startsWith("/admin/reports/history/") ||
    pathname.startsWith("/admin/reports/run/")
  );
}

function isPrimaryHrefActive(pathname: string, href: string) {
  if (href === "/admin/reports") return overviewActive(pathname);
  if (href === "/admin/reports/templates") return templatesActive(pathname);
  if (href === "/admin/reports/scheduled") return scheduledActive(pathname);
  if (href === "/admin/reports/packs") return packsActive(pathname);
  if (href === "/admin/reports/history") return historyActive(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isSecondaryHrefActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Any nav item matches the current pathname (overview when no subsection matches). */
function isNavHrefActive(pathname: string, href: string) {
  if (href === "/admin/reports") {
    return overviewActive(pathname);
  }
  return isSecondaryHrefActive(pathname, href) || isPrimaryHrefActive(pathname, href);
}

export function ReportsHubNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeSecondary = useMemo(
    () => SECONDARY.find((item) => isSecondaryHrefActive(pathname, item.href)),
    [pathname],
  );

  return (
    <>
      <nav

        aria-label="Reports sections"
        className={cn(
          "hidden md:inline-flex h-9 items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-1",
        )}
      >
        {PRIMARY.map((item) => {
          const active =
            item.href === "/admin/reports"
              ? overviewActive(pathname)
              : isPrimaryHrefActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}

              aria-current={active ? "page" : undefined}
              tabIndex={0}
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
                ? `More reporting views — submenu (current: ${activeSecondary.label})`
                : "More reporting views submenu"
            }
          >
            More
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
                        active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
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

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          className={cn(
            "md:hidden inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[12px] font-medium",
            "text-foreground transition-colors hover:bg-secondary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label="Open reports sections"
        >
          <Menu className="size-4" aria-hidden />
          Sections
        </SheetTrigger>
        <SheetContent side="right" className="w-[280px] p-0" showCloseButton={false}>
          <SheetHeader className="border-b border-border/60 px-4 py-3">
            <SheetTitle className="text-[14px] font-semibold tracking-tight">Reporting Hub</SheetTitle>
          </SheetHeader>
          <nav
            aria-label="Reports sections"
            className="flex flex-col gap-1 p-2"
            onClick={() => setMobileOpen(false)}
          >
            {[...PRIMARY, ...SECONDARY].map((item) => {
              const active = isNavHrefActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center rounded-md px-2 text-[13px]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
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
