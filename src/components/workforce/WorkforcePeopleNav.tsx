"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2 } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { useApplyFacilityScope } from "@/hooks/useApplyFacilityScope";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "People", href: "/admin/staff", owns: (path: string) => path === "/admin/staff" || path.startsWith("/admin/staff/") && !path.startsWith("/admin/staff/directory") && !path.startsWith("/admin/staff/staff-check") },
  { label: "Training", href: "/admin/training", owns: (path: string) => path === "/admin/training" || path.startsWith("/admin/training/") },
  { label: "Certifications", href: "/admin/certifications", owns: (path: string) => path === "/admin/certifications" || path.startsWith("/admin/certifications/") },
  { label: "Directory and exports", href: "/admin/staff/directory", owns: (path: string) => path === "/admin/staff/directory" || path.startsWith("/admin/staff/directory/") },
  { label: "Staff check", href: "/admin/staff/staff-check", owns: (path: string) => path === "/admin/staff/staff-check" || path.startsWith("/admin/staff/staff-check/") },
];

export function isWorkforcePeopleRoute(pathname: string): boolean {
  return tabs.some((tab) => tab.owns(pathname));
}

export function WorkforcePeopleNav() {
  const pathname = usePathname();
  const { user } = useHavenAuth();
  const selectedFacilityId = useFacilityStore((state) => state.selectedFacilityId);
  const availableFacilities = useFacilityStore((state) => state.availableFacilities);
  const facilitiesCacheUserId = useFacilityStore((state) => state.facilitiesCacheUserId);
  const { applyFacilityScope, pending } = useApplyFacilityScope();
  const facilities = facilitiesCacheUserId === user?.id ? availableFacilities : [];

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
        <Select
          value={selectedFacilityId ?? "all"}
          onValueChange={(value) => applyFacilityScope(value === "all" ? null : value)}
          disabled={pending}
        >
          <SelectTrigger aria-label="Change facility" className="mb-1 w-52">
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities.map((facility) => (
              <SelectItem key={facility.id} value={facility.id}>
                {facility.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
