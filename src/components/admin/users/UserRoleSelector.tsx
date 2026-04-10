/**
 * UserRoleSelector — hierarchy-aware role dropdown.
 * Only shows roles the current user is allowed to assign.
 */

"use client";

import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, getAssignableRoles } from "@/lib/rbac";

interface UserRoleSelectorProps {
  value: string;
  onChange: (role: string) => void;
}

export function UserRoleSelector({ value, onChange }: UserRoleSelectorProps) {
  const { user } = useAuth();
  const currentRole = (user?.app_metadata?.app_role as string) ?? "";
  const assignable = getAssignableRoles(currentRole);

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">Role</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">Select a role...</option>
        {assignable.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role] ?? role}
          </option>
        ))}
      </select>
      {value && ROLE_DESCRIPTIONS[value] && (
        <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[value]}</p>
      )}
    </div>
  );
}
