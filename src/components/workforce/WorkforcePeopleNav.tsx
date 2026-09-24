"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";

import type { Facility } from "@/hooks/useFacilityStore";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "People", href: "/admin/staff", owns: (path: string) => path === "/admin/staff" || path.startsWith("/admin/staff/") && !path.startsWith("/admin/staff/directory") && !path.startsWith("/admin/staff/staff-check") },
  { label: "Training", href: "/admin/training", owns: (path: string) => path === "/admin/training" || path.startsWith("/admin/training/") },
  { label: "Certifications", href: "/admin/certifications", owns: (path: string) => path === "/admin/certifications" || path.startsWith("/admin/certifications/") },
  { label: "Directory and exports", href: "/admin/staff/directory", owns: (path: string) => path === "/admin/staff/directory" || path.startsWith("/admin/staff/directory/") },
  { label: "Staff check", href: "/admin/staff/staff-check", owns: (path: string) => path === "/admin/staff/staff-check" || path.startsWith("/admin/staff/staff-check/") },
];

export function WorkforcePeopleNav({
  pathname,
  facilities,
  selectedFacilityId,
  pending,
  onFacilityChange,
}: {
  pathname: string;
  facilities: Facility[];
  selectedFacilityId: string | null;
  pending: boolean;
  onFacilityChange: (facilityId: string | null) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border">
      <nav aria-label="Workforce people tabs" className="flex min-w-0 flex-wrap items-center gap-1">
        {tabs.map((tab) => {
          const active = tab.owns(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {facilities.length > 1 ? (
        <label className="mb-1 inline-flex items-center gap-2">
          <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Change facility</span>
          <select
            aria-label="Change facility"
            value={selectedFacilityId ?? "all"}
            onChange={(event) => onFacilityChange(event.target.value === "all" ? null : event.target.value)}
            disabled={pending}
            className="h-8 w-52 rounded-lg border border-input bg-background px-2.5 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="all">All Facilities</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
