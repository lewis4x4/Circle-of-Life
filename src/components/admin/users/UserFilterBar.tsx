/**
 * UserFilterBar — search, role, facility, and status filters.
 */

"use client";

import { Input } from "@/components/ui/input";
import { ROLE_LABELS, ALL_APP_ROLES } from "@/lib/rbac";
import { useFacilityStore } from "@/hooks/useFacilityStore";

interface UserFilterBarProps {
  search: string;
  role: string;
  facilityId: string;
  status: string;
  onSearchChange: (v: string) => void;
  onRoleChange: (v: string) => void;
  onFacilityChange: (v: string) => void;
  onStatusChange: (v: string) => void;
}

export function UserFilterBar({
  search,
  role,
  facilityId,
  status,
  onSearchChange,
  onRoleChange,
  onFacilityChange,
  onStatusChange,
}: UserFilterBarProps) {
  const { facilities } = useFacilityStore();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Input
        placeholder="Search email or name..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="text-sm"
      />

      <select
        value={role}
        onChange={(e) => onRoleChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">All Roles</option>
        {ALL_APP_ROLES.filter((r) => r !== "family").map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r] ?? r}
          </option>
        ))}
      </select>

      <select
        value={facilityId}
        onChange={(e) => onFacilityChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">All Facilities</option>
        {facilities.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>

      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="deleted">Deleted</option>
      </select>
    </div>
  );
}
